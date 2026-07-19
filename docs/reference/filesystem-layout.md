# Filesystem layout

## Repository structure

```text
discordagent/
├── data/                        # Default runtime state; ignored by Git
│   ├── discordagent.sqlite      # SQLite operational store
│   ├── projects.json            # Optional one-time legacy import input
│   └── discordagent-worktrees/  # Managed isolated task worktrees
├── src/
│   ├── index.ts                 # Discord client, lock, startup, review-source wiring, shutdown
│   ├── agents/
│   │   ├── contracts.ts         # Provider-neutral coding-agent contracts
│   │   ├── providerRegistry.ts  # Provider registration and lookup
│   │   ├── claude/              # Claude Agent SDK adapter
│   │   ├── codex/               # Codex App Server transport, auth, provider
│   │   └── opencode/            # ACP transport, normalization, provider
│   ├── commands/                # Application and context command handlers
│   ├── coordinator/             # Durable task lifecycle and recovery
│   ├── db/                      # SQLite handle, schema, and migrations
│   ├── repositories/            # SQL access layer
│   ├── git/                     # Safe Git wrapper and worktree manager
│   ├── discord/                 # Rendering, controls, and capability evaluation
│   ├── handlers/                # Discord event routing
│   ├── integrations/
│   │   ├── reviewSource.ts      # Review-source lifecycle contract
│   │   └── roborev/             # RoboRev CLI adapter, parser, lifecycle, renderer
│   ├── services/                # Runtime assembly and supporting services
│   ├── primary/                 # PM-style primary-agent boundary and memory
│   └── smoke/                   # Host and Discord preflight checks
├── docs/                        # Diátaxis documentation
├── dist/                        # Compiled output; ignored by Git
├── .env                         # Local secrets and configuration; ignored by Git
├── .env.example                 # Configuration template
├── AGENTS.md                    # Coding-agent instructions
├── CLAUDE.md                    # Claude-specific repository instructions
├── package.json
└── tsconfig.json
```

The `data/` directory is created only when runtime state is needed and is not committed. Existing installations may continue using one historical `src/data/` or `dist/data/` directory under the compatibility policy below.

## Runtime paths

| Path | Purpose |
|---|---|
| `<DATABASE_PATH>` | SQLite operational database |
| `<data-root>/projects.json` | Optional legacy project import file associated with the selected database |
| `<WORKTREES_BASE_DIR>/` | Managed parent directory for isolated task worktrees |
| `<WORKTREES_BASE_DIR>/agent--<provider>--<slug>-<thread-suffix>/` | Usual task-worktree directory name |

The branch name and directory name are related but not identical:

- branch: `agent/<provider>/<slug>-<thread-suffix>`;
- directory: `agent--<provider>--<slug>-<thread-suffix>`.

`WorktreeManager` replaces `/` with `--` when deriving the directory name from the branch. If that directory already exists, it appends a numeric collision suffix such as `-2`.

Fresh installations select `<repository>/data` as the data root regardless of whether JavaScript runs from `src` through `tsx` or from compiled `dist` output. Host preflight calls the same resolver as runtime.

Compatibility selection is non-destructive:

1. If no default root contains state, use `<repository>/data`.
2. If exactly one of `<repository>/data`, `<repository>/src/data`, or `<repository>/dist/data` contains a database, legacy project file, or managed-worktree directory, reuse that root in place.
3. If more than one root contains state, fail and require an explicit `DATABASE_PATH` rather than choosing one silently.
4. When `DATABASE_PATH` is explicit, use it exactly and derive the legacy project path and default worktree parent beside it. An explicit `WORKTREES_BASE_DIR` overrides that worktree location.

RoboRev uses the configured host executable and repository-local configuration. It does not create an additional durable runtime directory or store webhook credentials.

## Branch naming

Task branches use:

```text
agent/<provider>/<slug>-<thread-suffix>
```

- `provider` is `claude`, `codex`, or `opencode`.
- `slug` is derived from a redacted, normalized form of the task objective and is length-limited.
- `thread-suffix` is derived from the final characters of the Discord thread ID.
- A task-derived suffix and then a numeric suffix are added when a branch name collides.

## Base-ref resolution

The worktree base is resolved in this order:

1. The project's explicitly configured base branch
2. The symbolic remote default, such as `origin/main`
3. The repository's currently checked-out local branch

A detached `HEAD` without an explicitly configured base branch is rejected.

## Safety rules

- Task worktrees must remain beneath `WORKTREES_BASE_DIR`.
- Dirty worktrees are never force-removed.
- The runtime does not use force reset, force checkout, or force worktree removal.
- Project removal archives the project and deletes its Discord channels; it does not delete historical task worktrees.
- Review sources do not receive task worktree ownership or provider-session state.

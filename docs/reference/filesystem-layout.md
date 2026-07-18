# Filesystem layout

## Repository structure

```text
discordagent/
├── src/
│   ├── index.ts                 # Discord client, lock, startup and shutdown
│   ├── agents/
│   │   ├── contracts.ts         # Provider-neutral domain contracts
│   │   ├── providerRegistry.ts  # Provider registration and lookup
│   │   ├── claude/              # Claude Agent SDK adapter
│   │   ├── codex/               # Codex App Server transport, auth, provider
│   │   └── opencode/            # ACP transport, normalization, provider
│   ├── commands/                # Application command handlers and definitions
│   ├── coordinator/             # Durable task lifecycle and recovery
│   ├── db/                      # SQLite handle, schema, and migrations
│   ├── repositories/            # SQL access layer
│   ├── git/                     # Safe Git wrapper and worktree manager
│   ├── discord/                 # Rendering, controls, and capability evaluation
│   ├── handlers/                # Discord event routing
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

## Runtime paths

| Path | Purpose |
|---|---|
| `<DATABASE_PATH>` | SQLite operational database |
| `<WORKTREES_BASE_DIR>/` | Managed parent directory for isolated task worktrees |
| `<WORKTREES_BASE_DIR>/agent--<provider>--<slug>-<thread-suffix>/` | Usual task-worktree directory name |

The branch name and directory name are related but not identical:

- branch: `agent/<provider>/<slug>-<thread-suffix>`;
- directory: `agent--<provider>--<slug>-<thread-suffix>`.

`WorktreeManager` replaces `/` with `--` when deriving the directory name from the branch. If that directory already exists, it appends a numeric collision suffix such as `-2`.

Development normally stores the database at `src/data/discordagent.sqlite`; compiled execution normally stores it at `dist/data/discordagent.sqlite`. When `DATABASE_PATH` is set explicitly, the default worktree parent is a `discordagent-worktrees` directory beside that database file.

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

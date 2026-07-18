# Filesystem layout

## Repository structure (source)

```
discordagent/
├── src/
│   ├── index.ts                 # Discord client, lock, startup/shutdown
│   ├── agents/
│   │   ├── contracts.ts         # Provider-neutral domain contracts
│   │   ├── providerRegistry.ts  # Provider registration and lookup
│   │   ├── claude/              # Claude Agent SDK adapter
│   │   ├── codex/               # Codex App Server transport, auth, provider
│   │   └── opencode/            # ACP transport, normalization, provider
│   ├── commands/
│   │   ├── definitions.ts       # Slash command builders
│   │   └── ...                  # Command handlers
│   ├── coordinator/
│   │   ├── taskCoordinator.ts   # Durable task lifecycle
│   │   ├── taskRecovery.ts      # Startup recovery for interrupted tasks
│   │   └── ...                  # Tests
│   ├── db/                      # SQLite handle, schema, migrations
│   ├── repositories/            # SQL access layer (project, task, event, etc.)
│   ├── git/
│   │   ├── gitClient.ts         # Safe Git process wrapper
│   │   └── worktreeManager.ts   # Worktree creation/management
│   ├── discord/
│   │   ├── capabilities/        # Permission registry, profiles, evaluator
│   │   ├── DiscordTaskRenderer.ts
│   │   └── DiscordInteractionBroker.ts
│   ├── handlers/                # Discord event routing
│   ├── services/                # Runtime, loopRunner, roborevWatcher, usage
│   ├── primary/                 # Primary agent contracts, journal, memory
│   └── smoke/                   # Preflight and connectivity checks
├── docs/                        # Documentation (Diátaxis structure)
├── dist/                        # Compiled output (gitignored)
├── .env                         # Local configuration (gitignored)
├── .env.example                 # Configuration template
├── AGENTS.md                    # Coding-agent instructions
├── CLAUDE.md                    # Legacy coding-agent instructions
├── package.json
└── tsconfig.json
```

## Runtime filesystem

| Path | Purpose |
|---|---|
| `<DATABASE_PATH>` | SQLite database (default: `src/data/discordagent.sqlite` dev, `dist/data/discordagent.sqlite` built) |
| `<WORKTREES_BASE_DIR>/` | Isolated Git worktrees (default: `<db-dir>/discordagent-worktrees/`) |
| `<WORKTREES_BASE_DIR>/agent/<provider>/<slug>-<thread-suffix>/` | Individual task worktree |

## Branch naming

Task branches follow this pattern:

```
agent/<provider>/<slug>-<thread-suffix>
```

- `provider` — `claude`, `codex`, or `opencode`
- `slug` — derived from the task objective
- `thread-suffix` — last few characters of the Discord thread ID

## Base branch resolution

When creating a worktree, the base branch is resolved in this order:

1. Project's explicitly configured base branch
2. Symbolic remote default (e.g., `origin/main`)
3. Current local branch

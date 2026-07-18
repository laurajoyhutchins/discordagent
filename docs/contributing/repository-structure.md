# Repository structure

## Source layout

```
src/
├── index.ts                 # Entry point: Discord client, lock, startup/shutdown
├── agents/
│   ├── contracts.ts         # Provider-neutral domain contracts (AgentProvider, AgentEvent, etc.)
│   ├── providerRegistry.ts  # Registration and lookup
│   ├── claude/              # Claude Agent SDK adapter
│   ├── codex/               # Codex App Server transport, auth, provider
│   └── opencode/            # ACP transport, normalization, provider
├── commands/
│   ├── definitions.ts       # SlashCommandBuilder definitions
│   └── *.ts                 # Command handlers
├── coordinator/
│   ├── taskCoordinator.ts   # Durable task lifecycle
│   ├── taskRecovery.ts      # Startup recovery
│   └── *.test.ts            # Tests
├── db/                      # SQLite handle, schema, migrations
├── repositories/            # SQL access (project, task, event, settings, memory, usage)
├── git/
│   ├── gitClient.ts         # Safe Git process wrapper
│   └── worktreeManager.ts   # Worktree creation and management
├── discord/
│   ├── capabilities/        # Permission registry, profiles, evaluator
│   ├── DiscordTaskRenderer.ts
│   └── DiscordInteractionBroker.ts
├── handlers/                # Discord event routing
├── services/                # Runtime, loopRunner, roborevWatcher, usage, projectStore
├── primary/                 # Primary agent contracts and models
└── smoke/                   # Preflight and connectivity checks
```

## Documentation layout

```
docs/
├── README.md                # Documentation gateway
├── tutorials/               # Guided end-to-end journeys
├── how-to/                  # Goal-oriented procedures
│   ├── discord/             # Discord bot setup
│   ├── providers/           # Provider configuration
│   ├── projects/            # Project management
│   ├── operations/          # Operational procedures
│   └── integrations/        # External integrations
├── reference/               # Authoritative reference
└── explanation/             # Architecture and rationale
    ├── architecture/        # Runtime topology, isolation, recovery
    ├── security/            # Trust model, auth, redaction
    ├── decisions/           # Architecture Decision Records
    └── product/             # Motivation and design philosophy
```

## File naming conventions

- Source files: `camelCase.ts`
- Test files: `*.test.ts` alongside source
- Documentation: `kebab-case.md`
- Provider modules: `kebab-case/` subdirectory

## Architecture boundaries

1. **Provider-neutral core** — `contracts.ts` defines all shared types. Do not import Discord or provider SDK types here.
2. **TaskCoordinator** owns lifecycle ordering. Handlers must not call provider SDKs directly.
3. **Provider isolation** — provider-specific code under `src/agents/<provider>/`. Normalize all output to `AgentEvent`.
4. **No in-place provider switching** — a provider change in a task thread is a sibling handoff, not a session conversion.
5. **Primary agent isolation** — the PM agent has no repository tools and cannot bypass `TaskCoordinator`.

# Repository structure

## Source layout

```text
src/
├── index.ts                 # Discord client, lock, startup, review-source wiring, shutdown
├── agents/
│   ├── contracts.ts         # Provider-neutral coding-agent contracts
│   ├── providerRegistry.ts  # Provider registration and lookup
│   ├── claude/              # Claude Agent SDK adapter
│   ├── codex/               # Codex App Server transport, auth, provider
│   └── opencode/            # ACP transport, normalization, provider
├── commands/
│   ├── definitions.ts       # Slash and context command builders
│   └── *.ts                 # Command handlers
├── coordinator/
│   ├── taskCoordinator.ts   # Durable coding-task lifecycle
│   ├── taskRecovery.ts      # Startup recovery
│   └── *.test.ts            # Coordinator tests
├── db/                      # SQLite handle, schema, migrations
├── repositories/            # SQL access for projects, tasks, events, settings, memory, usage
├── git/
│   ├── gitClient.ts         # Safe Git process wrapper
│   └── worktreeManager.ts   # Worktree creation and management
├── discord/                 # Capabilities, task rendering, interactions, control cards
├── handlers/                # Discord event routing
├── integrations/
│   ├── reviewSource.ts      # Generic review-source lifecycle and notification contract
│   └── roborev/             # RoboRev CLI adapter, parser, lifecycle, matching, renderer
├── services/                # Runtime assembly, loops, usage, project-store facade
├── primary/                 # PM-style primary agent, journal, memory, bounded context
└── smoke/                   # Host preflight and Discord connectivity checks
```

Coding-agent providers and review sources are separate extension boundaries:

- `src/agents/` executes durable coding tasks through `AgentProvider` and emits `AgentEvent` values.
- `src/integrations/` observes external review systems through `ReviewSource` and emits `ReviewNotification` values.

Do not place RoboRev under the provider registry or route review notifications through task-session state.

## Documentation layout

```text
docs/
├── README.md                # Documentation gateway
├── tutorials/               # Guided end-to-end journeys
├── how-to/                  # Goal-oriented procedures
│   ├── discord/             # Discord bot setup
│   ├── providers/           # Coding-agent provider configuration
│   ├── projects/            # Project management
│   ├── operations/          # Operational procedures
│   └── integrations/        # Optional external integrations
├── reference/               # Authoritative commands, configuration, states, capabilities
└── explanation/             # Architecture and rationale
    ├── architecture/        # Runtime, isolation, recovery, review-source boundaries
    ├── security/            # Trust model, authentication, redaction
    ├── decisions/           # Architecture Decision Records
    └── product/             # Motivation and design philosophy
```

## File naming conventions

- Source files: `camelCase.ts`
- Test files: `*.test.ts` alongside source
- Documentation: `kebab-case.md`
- Provider and integration modules: descriptive subdirectories

## Architecture boundaries

1. **Provider-neutral core** — `src/agents/contracts.ts` defines shared coding-agent types. Do not import Discord or provider SDK types there.
2. **TaskCoordinator authority** — handlers and integrations do not start providers directly or create competing task state.
3. **Provider isolation** — provider-specific code stays under `src/agents/<provider>/` and normalizes output to `AgentEvent`.
4. **Review-source isolation** — external review adapters implement `ReviewSource`; they do not become agent providers or task events.
5. **Immutable task provider** — a provider change in a task thread creates a sibling handoff, not a session conversion.
6. **Primary-agent isolation** — the PM agent has no repository tools and cannot bypass `TaskCoordinator`.

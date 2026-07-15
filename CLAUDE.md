# Discord Agent Development Guide

## Project overview

Discord Agent is a provider-neutral Discord orchestration runtime derived from DiscordClaude. Phase 1 executes Claude Code through `ClaudeProvider`; later phases add Codex App Server and a persistent PM-style primary agent.

The generic runtime must not depend directly on the Anthropic SDK. Provider-specific behavior belongs under `src/agents/<provider>/` and emits normalized `AgentEvent` values.

## Tech stack

- Node.js 22+
- TypeScript ES2022 modules
- discord.js 14
- SQLite through `better-sqlite3`
- Anthropic Claude Agent SDK in `src/agents/claude/`
- Vitest
- Git CLI through `execFile` with `shell: false`

## Commands

```bash
npm ci
npm run dev
npm run register
npm test
npm run build
npm run check
```

## Architecture

```text
Discord messages / commands
            │
            ▼
      TaskCoordinator
       │     │      │
       │     │      └── DiscordTaskRenderer + DiscordInteractionBroker
       │     └───────── Task/Event/Project repositories → SQLite
       └─────────────── WorktreeManager → isolated Git worktree
            │
            ▼
      ProviderRegistry
            │
            └── ClaudeProvider → Claude Agent SDK
```

`TaskCoordinator` owns lifecycle ordering. Handlers must not call provider SDKs directly.

## Required task-start ordering

1. resolve the registered project and provider;
2. verify provider availability;
3. create or receive the Discord thread;
4. create the Git branch and worktree;
5. persist task and worktree identity transactionally;
6. transition the task to `starting`;
7. call the provider;
8. persist the provider session immediately, before awaiting the completion promise;
9. transition to `running`;
10. persist normalized events and render them to Discord;
11. persist the result and terminal status.

If startup fails before task persistence, clean only the unpersisted clean worktree. Once a task record exists, preserve its worktree for inspection and recovery.

## Core boundaries

### Domain contracts

`src/agents/contracts.ts` defines:

- `AgentProviderId`
- `AgentProvider`
- `ProviderSession`
- `ProviderRun`
- `AgentEvent`
- `TaskResult`
- approval and user-question contracts

Do not import Discord or provider SDK types into these contracts.

### Providers

`ProviderRegistry` resolves provider implementations. Phase 1 registers only `ClaudeProvider`.

`ClaudeProvider` owns:

- SDK query construction;
- model resolution;
- user-only settings isolation;
- session start/resume;
- cancellation;
- Claude event normalization;
- usage and rate-limit callbacks.

Provider sessions are scoped by provider and immutable for a durable task. A continuation returning a different session identity is a failure.

### Coordinator

`TaskCoordinator` owns task creation, continuation, approval waiting states, cancellation, terminal results, safe closure, and restart recovery.

A successful turn may be continued later. Continuation reopens the same task transactionally while retaining its provider, session, branch, worktree, and event history.

### Discord

`DiscordTaskRenderer` renders normalized events. `DiscordInteractionBroker` collects approvals and questions using task/request-scoped component IDs.

Operational rules:

- verify the clicking member after collecting an interaction;
- consequential approval timeouts deny;
- question timeouts return an explicit skipped answer;
- never silently choose the first option;
- ordinary completion messages emphasize outcome, branch, verification, and unresolved decisions—not token telemetry.

### Persistence

`src/db/` owns migrations and database setup. Repository modules under `src/repositories/` own SQL access.

SQLite is authoritative for projects, tasks, worktrees, provider sessions, events, and results. `projectStore.ts` is a reduced compatibility facade for existing command modules; it delegates to `ProjectRepository` and does not maintain an independent JSON cache.

Important invariants:

- one task per Discord thread;
- one immutable provider per task;
- one worktree per Git-backed task;
- provider/session composite uniqueness;
- provider session stored before awaiting completion;
- idempotent event writes when a dedupe key is supplied;
- no credentials in SQLite.

### Git worktrees

`WorktreeManager` creates branches using:

```text
agent/<provider>/<slug>-<thread-suffix>
```

Base selection is explicit project base, then symbolic remote default, then current branch. Never add force flags to worktree removal, branch deletion, reset, or checkout. Dirty worktrees must be preserved.

### Recovery

At startup, nonterminal tasks become `interrupted`. `taskRecovery.ts` inspects the worktree and writes a checkpoint. `runtime.ts` attempts to post that checkpoint in the original thread. No provider turn is replayed automatically.

### Roborev

Roborev events are sent through the authenticated Discord bot client to `roborevChannelId`. Do not reintroduce webhook creation, tokens, DMs, or persisted webhook credentials.

## Security rules

- Keep global role authorization and path validation in front of task creation.
- Use `execFile`/`spawn` with `shell: false` for external commands.
- Treat repository content and provider output as untrusted.
- Claude must keep `settingSources: ['user']`; project/local settings remain ignored.
- Never log or persist Discord tokens, provider credentials, API keys, device codes, or webhook tokens.
- Keep the provider-neutral redaction boundary in `src/utils/redaction.ts`; sanitize normalized events before SQLite, Discord, and logs.
- Never auto-replay a partially executed provider turn.
- Never silently switch provider, model, scope, or reasoning quality.
- Never remove a dirty task worktree.

## File guide

| Area | Responsibility |
|---|---|
| `src/index.ts` | Discord client, lock/watchdog, runtime startup and shutdown. |
| `src/services/runtime.ts` | DB/migration/repository/provider/coordinator assembly and recovery notification. |
| `src/agents/contracts.ts` | Provider-neutral domain contracts. |
| `src/agents/providerRegistry.ts` | Provider registration and lookup. |
| `src/agents/claude/` | Claude SDK adapter and event normalization. |
| `src/coordinator/` | Durable task lifecycle and restart recovery. |
| `src/db/` | SQLite handle, schema, and migrations. |
| `src/repositories/` | Project, task, event, and legacy-import persistence. |
| `src/git/` | Safe Git process wrapper and worktree manager. |
| `src/discord/` | Provider-neutral rendering and interaction collection. |
| `src/handlers/` | Discord event routing into commands/coordinator. |
| `src/commands/` | Administrative slash commands. |
| `src/services/projectStore.ts` | Temporary reduced facade over `ProjectRepository`. |
| `src/services/loopRunner.ts` | Non-overlapping recurring turns in one durable task. |
| `src/services/roborevWatcher.ts` | Roborev CLI stream and bot-authenticated channel delivery. |
| `src/services/usageTracker.ts` | Claude usage detail for `/usage`. |

## Adding a provider

1. Implement `AgentProvider` under `src/agents/<provider>/`.
2. Normalize all provider output into `AgentEvent`.
3. Resolve `ProviderRun.session` as soon as the provider session exists.
4. Put authentication/account handling behind a provider-specific service.
5. Add contract fixtures and failure/recovery tests.
6. Register the provider in `runtime.ts` only after its complete lifecycle is available.
7. Update `/provider` so selection succeeds only when the runtime can execute it safely.

Do not add provider conditionals throughout handlers or the coordinator.

## Adding a command

1. Add the definition in `src/commands/definitions.ts`.
2. Add a focused handler and tests in `src/commands/`.
3. Route it from `src/handlers/interactionHandler.ts`.
4. Keep authorization centralized and add defense-in-depth where the command causes consequential changes.

## Testing expectations

New behavior follows red-green-refactor. Use:

- temporary SQLite files for repository tests;
- real temporary Git repositories for worktree tests;
- fake providers for coordinator lifecycle tests;
- lightweight Discord thread/message fakes for rendering and handler tests;
- provider message fixtures for adapter contract tests.

Before a checkpoint:

```bash
npm test
npm run build
git diff --check
```

## Phase 1 limitations

Codex is a recognized provider ID but is not executable. The primary-agent workspace, durable conversational memory, sibling provider handoffs, native polls, and usage-aware task admission are later phases. Do not simulate those capabilities in Phase 1 or silently fall back to Claude.

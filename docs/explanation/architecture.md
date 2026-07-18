# Architecture

Discord Agent is a provider-neutral orchestration runtime for AI coding agents. It maps Discord channels and threads to durable, isolated task executions backed by Git worktrees and SQLite.

## High-level structure

```
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
           ├── ClaudeProvider → Claude Agent SDK
           └── CodexProvider → Codex App Server
```

The system is divided into four layers:

### 1. Coordination layer

`TaskCoordinator` owns the lifecycle of every task. It enforces a strict ordering:

1. Resolve the project and provider
2. Verify provider availability
3. Create or receive the Discord thread
4. Create the Git branch and worktree
5. Persist task and worktree identity transactionally
6. Transition the task to `starting`
7. Call the provider
8. Persist the provider session immediately, before awaiting the completion promise
9. Transition to `running`
10. Persist normalized events and render them to Discord
11. Persist the result and terminal status

### 2. Provider layer

`ProviderRegistry` holds registered provider implementations. Each provider adapts a specific SDK or protocol to normalized `AgentEvent` values and `ProviderRun` contracts.

- `ClaudeProvider` wraps the Anthropic Claude Agent SDK
- `CodexProvider` communicates with a local Codex App Server via JSONL transport

Providers are stateless adapters; sessions are stored in SQLite and scoped immutably to one task.

### 3. Persistence layer

SQLite is the authoritative store for projects, tasks, worktrees, provider sessions, events, and results. Repositories under `src/repositories/` own all SQL access. Key invariants:

- One task per Discord thread
- One immutable provider per task
- One worktree per Git-backed task
- Provider/session composite uniqueness
- Idempotent event writes with dedupe keys

### 4. Discord layer

`DiscordTaskRenderer` renders normalized events to task threads. `DiscordInteractionBroker` collects approvals and user input using task-scoped component IDs.

A dedicated `PrimaryAgentService` runs a persistent PM-style agent in the `#agent-chat` channel, coordinating between providers and delegating coding tasks to the coordinator.

## Startup sequence

1. Lock file and single-instance check
2. Database open and migrations
3. Legacy project import (one-time)
4. Repository construction
5. Git worktree manager
6. Provider registration (Claude, Codex, or both)
7. Settings service assembly
8. Task coordinator construction
9. Primary channel creation or reconciliation
10. Provider onboarding or primary agent activation
11. Interrupted task recovery notification
12. Discord event listeners

## Recovery semantics

Nonterminal tasks at startup become `interrupted`. A checkpoint message is posted in the original thread. No provider turn is replayed automatically. The user must explicitly resume.

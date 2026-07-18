# Provider-neutral runtime

Discord Agent is a provider-neutral orchestration runtime for AI coding agents. It maps Discord channels and threads to durable, isolated task executions backed by Git worktrees and SQLite.

## Runtime topology

```text
#agent-chat
  → PrimaryAgentService
  → ClaudePrimaryModel | CodexPrimaryModel | OpenCodePrimaryModel
  → bounded context (pinned memory + projects + active tasks + recent/FTS history + usage posture)
  → TaskCoordinator for approved delegation

project #agent / task thread
  → TaskCoordinator
  → UsageAdmissionService
  → WorktreeManager + SQLite task/worktree/session records
  → ProviderRegistry
      ├── ClaudeProvider   → Claude Agent SDK
      ├── CodexProvider    → local Codex App Server JSON-RPC
      └── OpenCodeProvider → local opencode acp (ACP v1)
  → normalized events → SQLite + DiscordTaskRenderer
```

## Why provider-neutral?

Each provider (Claude, Codex, OpenCode) uses a fundamentally different transport and SDK. Rather than building provider-specific logic into every handler and the coordinator, the runtime defines a contract layer (`src/agents/contracts.ts`) that normalizes all provider behavior into:

- `AgentProviderId` — `'claude' | 'codex' | 'opencode'`
- `AgentProvider` — `startTask`, `continueTask`, `cancelTask`, `checkAvailability`, `estimateHandoff`
- `AgentEvent` — `text_delta`, `status`, `plan`, `command`, `file_change`, `approval_request`, `user_question`, `usage`, `session_started`, `completed`, `failed`
- `TaskResult` — normalized outcome, summary, verification, usage

Discord and provider SDK types never cross this boundary. Handlers and the coordinator import only these contracts.

## Task lifecycle

A new task follows this strict ordering:

1. Resolve the project and immutable provider
2. Verify provider availability and authentication
3. Reserve estimated provider capacity
4. Create or receive the Discord thread
5. Create an isolated Git branch and worktree
6. Persist task and worktree identity transactionally
7. Start the provider
8. Persist the provider session before awaiting completion
9. Stream redacted normalized events
10. Persist the terminal result and calibrate actual usage

Admission happens before Discord or Git side effects. A rejected task creates neither a thread nor a worktree. Continuations reserve a new turn budget while retaining the same task, provider session, branch, and worktree.

## Provider contracts

Each provider adapts a specific SDK or protocol to the normalized contract:

**ClaudeProvider** uses user-level Claude settings only. Project and local settings remain excluded.

**CodexProvider** uses one local App Server transport. Requests blocked by authentication are held in memory for up to 30 minutes and require an explicit post-login Start action before Discord or Git side effects occur.

**OpenCodeProvider** performs an ACP v1 availability probe, streams normalized events, and maps ACP permission requests to explicit Discord approvals. OpenCode has no filesystem or terminal callbacks from Discord Agent and never receives automatic approval.

## Primary models

Primary models implement conversation and structured delegation only. They receive bounded context and cannot bypass `TaskCoordinator`.

- **ClaudePrimaryModel** disables all Claude tools for a one-turn response.
- **CodexPrimaryModel** uses a read-only, network-disabled App Server turn.
- **OpenCodePrimaryModel** starts a one-turn ACP process with a dedicated deny-all primary agent, every tool disabled, every ACP permission request cancelled, and a disposable empty workspace.

## Immutable provider identity

A provider session is scoped by provider and immutable for a durable task. A continuation returning a different session identity is a failure. Provider switching is always a confirmed sibling handoff: the system estimates target input context, requires confirmation, creates a fresh target session and isolated worktree based on the clean committed source branch, and cross-links the threads.

## Startup sequence

1. Single-instance lock (TCP port)
2. Database open and migrations
3. Legacy project import (one-time from `projects.json`)
4. Repository construction
5. Git worktree manager
6. Provider registration
7. Settings service assembly
8. Task coordinator construction
9. Primary channel creation or reconciliation
10. Provider onboarding or primary agent activation
11. Interrupted task recovery notification
12. Discord event listeners

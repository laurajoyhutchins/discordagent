# Discord Agent Runtime Architecture

Discord Agent is a private, local-first Discord workspace with one persistent PM-style primary agent and isolated Claude, Codex, or OpenCode task agents. Generic orchestration depends only on provider-neutral contracts.

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
      └── OpenCodeProvider → local `opencode acp` (ACP v1)
  → normalized events → SQLite + DiscordTaskRenderer
```

## Task lifecycle

A new task follows this order:

1. resolve the project and immutable provider;
2. verify provider availability and authentication;
3. reserve estimated provider capacity;
4. create the Discord thread;
5. create an isolated Git branch/worktree;
6. persist task/worktree and attach the reservation;
7. start the provider;
8. persist the provider session before awaiting completion;
9. stream redacted normalized events;
10. persist the terminal result and calibrate actual usage.

Admission happens before Discord or Git side effects. A rejected task creates neither a thread nor a worktree. Continuations reserve a new turn budget while retaining the same task, provider session, branch, and worktree.

## Providers

`ClaudeProvider` uses user-level Claude settings only. Project/local settings remain excluded.

`CodexProvider` uses one local App Server transport. It supports initialization, account state, device-code login, thread start/resume, streamed items, approvals, user questions, rate-limit windows, bounded overload retry, interruption, and deterministic shutdown. Requests blocked by authentication are held in memory for up to 30 minutes and require an explicit post-login Start action before Discord or Git side effects occur. Credentials and one-time codes never enter SQLite.

`OpenCodeProvider` is an optional project/task provider backed by the local `opencode acp` CLI and the official ACP client transport. It performs an ACP v1 availability probe, streams normalized text, plans, commands, file changes, usage, and status events, and maps ACP permission requests to explicit Discord approvals. The task session identity is persisted before awaiting prompt completion; continuations load or resume that same session when the advertised capability permits it. OpenCode has no filesystem or terminal callbacks supplied by Discord Agent, and it never receives automatic approval.

`OpenCodePrimaryModel` uses a separate one-turn ACP process for each PM response. Its inline runtime configuration replaces inherited global permissions with `deny`, selects a dedicated primary agent whose own permissions deny every action, disables all agent tools, disables plugins declared through config, and turns off sharing, snapshots, and auto-update. The ACP permission handler also cancels every request. Each turn runs in a newly created empty temporary directory that is removed after the process closes. It receives only the bounded primary-agent prompt and returns provider-neutral structured coordination output; it does not share task sessions, worktrees, project MCP configuration, or tool approvals.

The runtime does not silently fall back to another provider when the OpenCode CLI is missing, unauthenticated, unavailable, or fails. PM activation returns to provider onboarding; task execution reports the provider-specific failure for an explicit user decision.

A provider switch is a confirmed sibling handoff. The system estimates target input context, requires confirmation, creates a fresh target session and isolated worktree based on the clean committed source branch, and cross-links the threads.

## Primary agent

The primary agent is deliberately tool-isolated. It can converse, retrieve history, propose decisions, write provenance-valid memory, and delegate through `TaskCoordinator`; it cannot edit repositories or call project MCP tools directly. Raw messages remain authoritative in SQLite, with FTS5 retrieval and bounded context assembly. Read-only policy memory cannot be overwritten by model output.

Claude disables tools through its SDK options. Codex runs a read-only, network-disabled coordination turn. OpenCode runs a dedicated deny-all agent with every tool disabled, cancels every ACP permission request, and uses a disposable empty workspace. These are provider-specific implementations of the same `PrimaryModel` boundary.

## Usage orchestration

Provider windows and reset times are stored as snapshots. Each task class has a low/high estimate calibrated from completed observations. Active holds are included when computing safe capacity, with a configurable reserve for primary-agent coordination.

Operating postures are `unknown`, `healthy`, `cautious`, `restricted`, `preserve`, and `exhausted`. Routine messages hide telemetry. When capacity is critical, the coordinator records a checkpoint and interrupts the provider at most once for that turn; task state, session, branch, and worktree remain available. `/usage` and `/agents` expose details on demand.

## Recovery and safety

Startup marks nonterminal tasks interrupted and never replays a possibly side-effecting turn. Dirty worktrees are never force-removed. Provider events and errors are redacted before persistence, Discord, and logs. Git commands use argument arrays with `shell: false`. Roborev posts through the authenticated bot and stores no webhook credentials.

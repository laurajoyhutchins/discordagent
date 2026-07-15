# Provider-Neutral Runtime Architecture

## Purpose

Phase 1 separates Discord orchestration, durable state, Git isolation, and provider execution so Claude remains functional while Codex and other providers can be added without rewriting the Discord surface.

## Lifecycle

A new task follows a strict write-before-side-effect sequence:

```text
resolve project/provider
→ verify provider availability
→ create Discord thread
→ create branch/worktree
→ persist task + worktree transactionally
→ mark starting
→ start provider
→ persist provider session before awaiting completion
→ mark running
→ persist/render normalized events
→ persist terminal result
```

The provider returns a `ProviderRun` containing a session identity and a separate completion promise. This split is intentional: Discord Agent must persist the provider session before it awaits a potentially long-running turn.

## Components

### TaskCoordinator

The coordinator is the application boundary. It validates provider immutability, creates task isolation, drives state transitions, attaches sessions, brokers approvals/questions, captures events, records results, cancels work, closes safe worktrees, and recovers interruptions.

### ProviderRegistry and providers

The registry maps `AgentProviderId` to one implementation. Generic code consumes only `AgentProvider`.

Phase 1 registers `ClaudeProvider`. It adapts the Claude Agent SDK into:

- early `ProviderSession` creation;
- streamed `AgentEvent` values;
- provider-neutral approvals and questions;
- cancellation;
- normalized task results and usage.

Codex is deliberately not registered until the App Server adapter can provide the same complete lifecycle.

### Repositories and SQLite

SQLite is the operational source of truth. Migrations run idempotently at startup. The repositories enforce provider-scoped sessions, task/thread uniqueness, task/worktree uniqueness, legal compare-and-set state transitions, recoverable-task queries, terminal-result rules, and event deduplication.

Legacy `projects.json` is imported once. Existing channel mappings and Claude model settings are preserved; old session IDs are not resumed automatically; webhook credentials are discarded.

### WorktreeManager

Every Git-backed task receives a unique branch and worktree. The manager serializes naming collisions, supports paths containing spaces, rejects unsafe Git operations, and refuses dirty removal. It never uses shell interpolation or force cleanup.

### Discord rendering and interaction

`DiscordTaskRenderer` translates normalized events to messages and embeds. `DiscordInteractionBroker` creates task/request-scoped component identifiers, verifies the responding member, denies timed-out consequential actions, and returns explicit skipped answers for unanswered questions.

### Runtime startup

`startRuntime()` performs:

1. database open and migrations;
2. one-time legacy import;
3. repository construction;
4. Git worktree manager construction;
5. Claude provider registration;
6. coordinator construction and global installation;
7. usage/Roborev client initialization;
8. interrupted-task recovery;
9. recovery checkpoint delivery when threads are available.

Any startup failure clears the global coordinator and closes the project database. Shutdown clears the coordinator and closes SQLite after loops/watchers are stopped by the process entry point.

## Recovery semantics

A process exit may leave tasks in `starting`, `running`, or `waiting_for_user`. On the next startup, Discord Agent:

- inspects the recorded worktree;
- marks the task `interrupted`;
- records whether the worktree is present, clean, or dirty;
- posts a concise checkpoint to the original thread when possible;
- requires an explicit message to continue.

It never assumes whether the previous provider turn had side effects and never replays that turn automatically.

## Continuation

A completed or failed turn can be continued in its original Discord thread. The repository reopens the durable task transactionally, and the coordinator resumes the exact provider session in the same worktree. Provider, session, branch, and thread identities cannot change.

## Roborev

Roborev is intentionally outside provider execution. The watcher reads `roborev stream`, matches repository paths with boundary-safe comparisons, and sends embeds with the authenticated bot. No webhook credential crosses the persistence boundary.

## Phase boundary

Phase 1 ends with a provider-neutral runtime and executable Claude provider. Codex App Server, guided authentication, sibling-thread provider handoff, the persistent PM agent, full conversational memory, polls, and usage admission are follow-on phases.

## Redaction boundary

Normalized provider events and errors are redacted before persistence, Discord rendering, and logging. The coordinator applies the central boundary, while provider adapters and error handlers add defense in depth.

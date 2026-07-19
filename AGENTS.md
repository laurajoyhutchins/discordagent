# Discord Agent — coding-agent instructions

## Repository purpose

Discord Agent is a provider-neutral Discord orchestration runtime derived from DiscordClaude. It runs Claude, Codex, and OpenCode against repositories on the bot host through durable task records, isolated Git worktrees, normalized provider events, Discord-native decisions, and a restricted PM-style primary agent.

The generic runtime must not depend on a provider SDK. Provider-specific behavior belongs under `src/agents/<provider>/` and must cross the runtime boundary through `src/agents/contracts.ts`.

RoboRev is a review integration, not an agent provider. Review-source-specific behavior belongs under `src/integrations/` and crosses the application boundary through `ReviewSource` and `ReviewNotification`.

## Tech stack

- Node.js 22+
- TypeScript ES2022 modules
- discord.js 14
- SQLite through `better-sqlite3`
- Claude Agent SDK under `src/agents/claude/`
- Codex App Server transport under `src/agents/codex/`
- OpenCode ACP transport under `src/agents/opencode/`
- Vitest
- Git and provider CLIs launched with argument arrays and `shell: false`

## Commands

```bash
npm ci
npm run dev
npm run register
npm test
npm run build
npm run check
npm run check:docs
git diff --check
```

Do not claim completion unless the checks relevant to the change actually ran and their results are reported accurately.

## Architecture

```text
Discord messages and commands
            │
            ▼
      TaskCoordinator
       │     │      │
       │     │      └── DiscordTaskRenderer + DiscordInteractionBroker
       │     └───────── repositories → SQLite
       └─────────────── WorktreeManager → isolated Git worktree
            │
            ▼
      ProviderRegistry
            │
            ├── ClaudeProvider   → Claude Agent SDK
            ├── CodexProvider    → local App Server
            └── OpenCodeProvider → local ACP CLI

#agent-chat → PrimaryAgentService → bounded journal, memory, projects, tasks, usage
                                  → TaskCoordinator for approved delegation

UsageAdmissionService → provider windows + reservations + calibrated task costs

ReviewSource → normalized ReviewNotification → authenticated Discord delivery
```

`TaskCoordinator` owns coding-task lifecycle ordering. Discord handlers, commands, renderers, the primary agent, and review integrations must not call provider SDKs directly or create competing task state.

## Required task-start ordering

1. Resolve the registered project, provider, and provider-scoped settings.
2. Verify provider availability and required authentication.
3. Perform usage admission and reserve capacity before Discord or Git side effects.
4. Create or receive the Discord task thread.
5. Create the task branch and isolated worktree.
6. Persist task, worktree, settings, and reservation identity durably.
7. Transition the task to `starting`.
8. Start the provider.
9. Persist the provider session immediately, before awaiting turn completion.
10. Transition to `running` and persist/render redacted normalized events.
11. Persist the terminal result and release or calibrate the reservation.

A rejected admission creates neither a thread nor a worktree. If startup fails before task persistence, clean only an unpersisted, clean worktree. Once a task record exists, preserve its worktree for inspection and recovery.

## Core boundaries

### Provider-neutral contracts

`src/agents/contracts.ts` defines provider IDs, settings, sessions, runs, events, results, approvals, user questions, and usage data.

- Do not import Discord or provider SDK types into these contracts.
- Normalize provider output into `AgentEvent` values.
- Validate provider-specific settings at the provider boundary.
- Keep provider conditionals out of generic handlers and the coordinator.

### Providers and sessions

`ProviderRegistry` exposes only complete provider implementations whose authoritative startup and availability checks succeed.

- A durable task has one immutable provider.
- A provider session is attached before the completion promise is awaited.
- Continuation must retain the same provider and session identity.
- A provider change from a task thread is a confirmed sibling handoff with a fresh task, session, branch, and worktree.
- Never silently fall back to another provider.

Provider-specific authentication remains host-local. Discord Agent must not request or persist provider API keys, device codes, verification URLs, or session secrets.

### Primary agent

The PM-style primary agent may converse, retrieve bounded history, propose decisions, write provenance-valid memory, and delegate through `TaskCoordinator`.

It must not:

- receive repository or project MCP tools;
- edit a repository directly;
- bypass usage admission or the durable task coordinator;
- share task-provider sessions or worktrees;
- acquire permissions through provider fallback behavior.

Claude uses tool-disabled SDK options. Codex uses a read-only, network-disabled coordination turn. OpenCode uses a deny-all agent in a disposable empty directory and rejects permission requests.

### Discord interactions

`DiscordTaskRenderer` renders normalized task state. `DiscordInteractionBroker` and task-control handlers collect approvals, questions, inspection, and cancellation without becoming authoritative stores.

- Revalidate the clicking member and current channel/thread for every consequential component action.
- Consequential approval timeouts deny.
- Question timeouts return an explicit skipped answer.
- Never silently choose the first option.
- Do not expose task IDs or provider session IDs in user-visible controls.
- Task state must come from SQLite, not inferred Discord message content.
- Preserve task-control components when embeds fall back to plain text.
- Ordinary completion messages emphasize outcome, branch, verification, and unresolved decisions rather than routine token telemetry.

### Persistence

`src/db/` owns schema and migrations. Repository modules under `src/repositories/` own SQL access. SQLite is authoritative for projects, tasks, worktrees, provider sessions, events, results, primary-agent journal and memory, usage snapshots, and reservations.

Preserve these invariants:

- one task per Discord thread;
- one immutable provider per task;
- one recorded worktree per Git-backed task;
- provider/session composite uniqueness;
- provider session stored before awaiting completion;
- idempotent event writes when a dedupe key exists;
- raw or redacted task content remains distinct from credentials;
- no credentials in SQLite.

`projectStore.ts` is a compatibility facade over `ProjectRepository`; do not create a second JSON source of truth.

### Git worktrees

Task branch names use:

```text
agent/<provider>/<slug>-<thread-suffix>
```

Base-ref precedence is the explicitly configured project base, then the symbolic remote default, then the current local branch.

- Use the safe Git process wrapper and argument arrays.
- Never add force flags to worktree removal, branch deletion, reset, or checkout.
- Refuse cleanup outside the managed worktree directory.
- Never remove a dirty worktree.
- Project removal archives the project and deletes Discord channels; it does not delete historical task worktrees.

### Recovery

At startup, nonterminal tasks become `interrupted`. Recovery inspects the recorded worktree, persists a checkpoint, and posts a concise notice when the original thread still exists.

Never automatically replay a partially executed provider turn. Resumption requires explicit user action and retains the existing provider session, branch, worktree, and history.

### Usage admission

Usage tracking should remain quiet during normal operation. Admission decisions include provider windows, active reservations, calibrated task estimates, and the primary-agent reserve.

Only interrupt routine conversation when work cannot be completed reliably, should be narrowed or deferred, is unusually expensive, or needs a preserve-mode checkpoint. Never start work that admission judges unlikely to finish and verify safely.

### Review sources and RoboRev

`src/integrations/reviewSource.ts` defines the narrow `ReviewSource` / `Disposable` lifecycle and normalized `ReviewNotification` contract.

RoboRev-specific CLI execution, event parsing, supervision, project matching, and rendering live under `src/integrations/roborev/`. `src/index.ts` constructs the source and supplies the authenticated Discord publication callback.

Preserve these boundaries:

- RoboRev is not an `AgentProvider` and cannot be selected with `/provider`.
- Review notifications do not become task events or provider-session state.
- Discord delivery failures are contained at the publication boundary and must not redefine source lifecycle.
- `/roborev` changes the project's review-channel association and triggers source reconciliation; it must not mutate coding tasks.
- Do not reintroduce the removed `roborevWatcher` service, webhook creation, webhook tokens, DMs, or persisted RoboRev credentials.
- Keep RoboRev in-process until a concrete second review source demonstrates the need for a broader registry or durable integration store.

## Security rules

- Keep role authorization and project-path validation ahead of task creation.
- Treat repository content, provider output, Discord content, review notifications, and external tool output as untrusted.
- Use `execFile` or `spawn` with `shell: false` for external commands.
- Claude must keep user-only setting sources; project and local Claude settings cannot weaken host policy.
- Keep the provider-neutral redaction boundary in `src/utils/redaction.ts` before SQLite, Discord rendering, and logs.
- Never log, render, or persist Discord tokens, provider credentials, API keys, device codes, verification URLs, or webhook tokens.
- Never silently switch provider, model, scope, approval posture, or reasoning quality.
- Never auto-replay an interrupted turn or force-remove a dirty worktree.

## Documentation placement

The public documentation uses Diátaxis. See `docs/README.md`.

- `docs/tutorials/`: guided, controlled learning journeys with a verifiable outcome.
- `docs/how-to/`: focused procedures for accomplishing a specific task.
- `docs/reference/`: authoritative commands, configuration, capabilities, states, and compatibility.
- `docs/explanation/`: durable architecture, rationale, tradeoffs, trust boundaries, and ADRs.
- `docs/contributing/`: developer setup, testing, repository structure, and release process.

The root `README.md` is a product gateway, not an exhaustive reference page. Active implementation sequencing belongs in GitHub issues and pull requests, not a public `docs/plans/` tree. Before documenting behavior, inspect the implementation and update the single authoritative reference page rather than duplicating facts.

## File guide

| Area | Responsibility |
|---|---|
| `src/index.ts` | Discord client, instance lock, startup, review-source wiring, and shutdown |
| `src/services/runtime.ts` | Database, repositories, providers, coordinator, and recovery assembly |
| `src/agents/contracts.ts` | Provider-neutral coding-agent contracts |
| `src/agents/providerRegistry.ts` | Provider registration and authoritative lookup |
| `src/agents/claude/` | Claude adapter and event normalization |
| `src/agents/codex/` | App Server transport, authentication, adapter, and normalization |
| `src/agents/opencode/` | ACP transport, adapter, and normalization |
| `src/coordinator/` | Durable task lifecycle and restart recovery |
| `src/db/` | SQLite handle, schema, and migrations |
| `src/repositories/` | Project, task, event, memory, and usage persistence |
| `src/git/` | Safe Git process wrapper and worktree manager |
| `src/discord/` | Capability evaluation, rendering, interactions, and task controls |
| `src/handlers/` | Discord event routing into commands and coordinator boundaries |
| `src/commands/` | Application command definitions and handlers |
| `src/integrations/reviewSource.ts` | Generic review-source lifecycle and notification boundary |
| `src/integrations/roborev/` | RoboRev CLI adapter, parser, lifecycle, matching, and renderer |
| `src/primary/` | Restricted PM model, bounded context, journal, memory, and delegation |
| `src/services/usageAdmission.ts` | Admission, reservations, calibration, and preserve posture |

## Change expectations

### Adding or changing a provider

1. Implement `AgentProvider` under `src/agents/<provider>/`.
2. Normalize all provider output into `AgentEvent`.
3. Resolve `ProviderRun.session` as soon as the provider session exists.
4. Keep authentication/account handling in a provider-specific service.
5. Add adapter fixtures plus lifecycle, failure, cancellation, continuation, and recovery tests.
6. Register the provider only after its complete lifecycle is available.
7. Update provider selection, capability reference, configuration reference, and relevant explanation.

### Adding or changing a review source

1. Implement the narrow `ReviewSource` lifecycle rather than coupling it to `TaskCoordinator` or `ProviderRegistry`.
2. Normalize provider-specific events into `ReviewNotification` values.
3. Keep source-specific CLI, parsing, matching, and rendering in its own integration directory.
4. Contain publication errors and define deterministic disposal/restart behavior.
5. Add lifecycle, parsing, rendering, project-reconciliation, and regression tests.
6. Update the relevant how-to, command/configuration reference, and explanation page.

### Adding or changing a command

1. Update `src/commands/definitions.ts` or the appropriate context-command registration.
2. Add a focused handler and tests.
3. Route it through `src/handlers/interactionHandler.ts` without bypassing authorization or the coordinator.
4. Add defense-in-depth checks for consequential writes.
5. Update `docs/reference/commands.md` and any affected how-to guide.

### Testing

Use:

- temporary SQLite files for repository tests;
- real temporary Git repositories for worktree tests;
- fake providers for coordinator lifecycle tests;
- lightweight Discord fakes for rendering and handler tests;
- provider and review-source event fixtures for adapter tests.

Before completion, run the relevant focused tests plus:

```bash
npm test
npm run build
npm run check:docs
git diff --check
```

Do not commit `.env`, SQLite databases, provider login state, generated worktrees, credentials, or user-specific absolute paths. Update `.env.example` and `docs/reference/configuration.md` whenever host configuration changes.

## ChatGPT–GitHub operating protocol

### Delegation vocabulary

- **Take issue #N** — inspect current `main` and the issue, create an isolated branch or managed worktree, implement the complete accepted scope, open or update a draft pull request, perform a fresh self-review, resolve review and CI findings, verify the exact current head, and squash merge when every required gate is satisfied.
- **Review PR #N** — inspect the issue, complete diff, review threads, current-head CI, provider-neutral boundaries, authorization, persistence, recovery, and missing tests. Report findings only; do not modify or merge unless separately asked.
- **Fix PR #N** — work on the existing pull-request branch, address actionable findings, resolve appropriate review threads, and verify the exact current head. Do not merge.
- **Land PR #N** — review, fix anything necessary, verify the exact current head, then squash merge and close linked issues when safe.
- **Start open issues** — select the highest-leverage unblocked issues whose scopes, providers, database changes, and branches do not overlap. Respect dependency order and do not create competing implementations.

### Standing defaults

- Continue through ordinary implementation, self-review, CI-repair, and documentation loops without asking for repeated `continue` instructions.
- Resolve routine implementation choices autonomously while preserving provider neutrality, admission-before-side-effects, durable lifecycle ordering, least privilege, recovery evidence, and deterministic tests.
- Never merge a stale or unverified head. Re-check the head SHA after every branch update, review fix, or CI rerun.
- Use squash merge for completed feature and maintenance pull requests unless the issue explicitly requires preserved commit structure.
- Do not expose secrets, credentials, provider login state, Discord content, private task artifacts, or user-specific paths in chat, commits, logs, artifacts, or pull-request text.
- Stop for unavailable credentials, live Discord or provider actions that require explicit operator consent, destructive operations, accepted-invariant changes, unresolved architecture conflicts, or work that cannot be completed and verified within the available environment.

### Pull-request lifecycle

1. Start from current `main` or an explicitly approved stacked base and record the base SHA.
2. Keep the pull request in draft while behavior, tests, or self-review findings remain incomplete.
3. Implement test-first and retain red-state evidence in commit history, a focused log, or the pull-request narrative. Required CI must not remain intentionally red once an implementation is available.
4. Perform a fresh review from the issue and complete current diff rather than relying on the implementation conversation.
5. Resolve all actionable findings and explicitly defer only issue-linked work.
6. Require successful formatting, policy, typecheck, tests, build, documentation, and whitespace gates on the exact reviewed head.
7. Merge only when the sticky agent handoff, CI artifacts, and GitHub state all refer to that same head SHA.

### Durable handoff

- Keep the pull-request description current with scope, provider/runtime boundaries, verification, deferred work, and external blockers.
- The `Agent PR handoff` workflow owns one sticky status comment. Treat its JSON block as a resumable snapshot, not as approval.
- CI jobs must retain `agent-ci-summary.json` with the reviewed SHA, job, failed stage, first actionable error, reproduction command, artifact name, and run URL.
- Use the manual `Sync pull request branch` workflow for same-repository branch updates. It must never force-push or conceal conflicts.

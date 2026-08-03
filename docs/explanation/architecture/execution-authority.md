# Discord product and execution authority

Discord Agent is an operator-facing Discord workspace. Its durable product authority is Discord identity, interaction, conversation, presentation, and operator workflow. It currently also contains a complete direct-provider execution runtime. That runtime remains supported compatibility behavior, not evidence that Discord Agent should remain the portfolio execution authority.

Factory Floor is the target authoritative substrate for executions, attempts, workers, artifacts, retries, cancellation fencing, recovery, and runtime inspection. The current repositories do not yet expose a complete, proven contract for submitting and continuing every Discord coding task through Factory Floor. Discord Agent therefore uses a named transitional hybrid rather than a silent cutover.

## Current architecture model

The accepted current model is **Model C: transitional hybrid**.

| Container or system | Current responsibility | Authority classification |
|---|---|---|
| Discord gateway and handlers | Authenticate members, validate guild/channel/thread context, register commands, receive controls | Canonical Discord Agent product authority |
| Primary-agent conversation | Bounded PM-style conversation, task proposals, questions, polls, operator decisions | Canonical local interaction role; not a canonical Engineering Agent Team identity |
| Task presentation | Dedicated threads, task cards, notifications, concise summaries, fallback rendering | Canonical Discord presentation and local projection |
| Local task runtime | Provider startup, sessions, task lifecycle, worktrees, local events/results, restart interruption | Explicit `local_provider` compatibility backend |
| Factory Floor Activity adapter | Trusted launch, service authentication, bindings, Activity presentation | Operator client and projection boundary |
| Factory Floor | Commands, runs, executions, attempts, workers, artifacts, policy, retries, cancellation, runtime recovery | External execution authority when used |
| Engineering Agent Team | Durable agent identity, role behavior, operating contracts, deployment metadata, compiled artifacts | External agent-definition authority |
| Linear | Portfolio demand, dependencies, blockers, readiness, assignments, verification and owner decisions | External portfolio authority |
| Product repositories | Code, branches, pull requests, checks, repository decisions and evidence | External repository authority |

Discord messages are never execution truth. Editing or deleting a Discord message does not rewrite a task, provider session, Factory Floor run, or product-repository fact.

## Durable task backend identity

Every local `tasks` record has an immutable `execution_backend` value:

- `local_provider`: Discord Agent owns the compatibility task lifecycle, provider session, local worktree, normalized events, result, and restart interruption record.
- `factory_floor`: reserved for an explicit Factory Floor-backed task projection contract. The local worktree creation path rejects this identity and cannot fabricate a Factory Floor task.

Migration 14 backfills every prior task as `local_provider`. This is a truthful classification of historical behavior, not a migration of work into Factory Floor.

The execution backend must be visible to operators where a task is rendered. A task never changes provider or backend in place. Provider handoff creates a sibling task. A future backend handoff must also create a distinct task or mapping with independently meaningful identifiers.

## Responsibility disposition

| Responsibility | Disposition | Retirement or acceptance condition |
|---|---|---|
| Discord commands, role authorization, thread creation, controls, polls, questions and notifications | Remain canonical | None |
| Primary-agent conversation journal and bounded memory | Remain canonical local product state | Keep separate from coding sessions and repository mutation tools |
| Factory Floor clients, service authentication and local Discord bindings | Retain and extract only after a second consumer proves a reusable package boundary | Preserve least privilege and directional credentials |
| Local `TaskCoordinator` ordering | Compatibility execution coordinator now; evolve toward operator-side workflow coordination | Factory Floor contract must cover request idempotency, execution identity, cancellation, continuation, events and recovery |
| Claude, Codex and OpenCode task adapters | Compatibility runtime now | Move behind Factory Floor workers only after capability and session-continuation parity is proven per provider |
| Local Git worktree manager | Compatibility runtime now | Factory Floor or its workers must provide exact base commit, managed-root ownership, dirty-worktree refusal and inspectable cleanup |
| Local usage admission and reservations | Compatibility runtime policy | Owner must decide whether admission belongs to Factory Floor or remains an operator-side advisory projection |
| SQLite task events, results and provider sessions | Authoritative only for `local_provider` tasks | Become compatibility records or removable duplicates after all supported tasks use Factory Floor |
| Factory Floor bindings, cursors, rendered digests and interaction state | Local projection and mapping | Must never become a copied Factory Floor event store |

## Migration gates

A Factory Floor-backed coding-task path may be introduced only when all of these are true:

1. A versioned operator-client contract exists for task submission, idempotency, status, cancellation, continuation or retry, and safe error representation.
2. Discord Agent can persist an explicit backend plus separate local task and Factory Floor execution identifiers without implying equivalence.
3. Provider and worktree ownership are unambiguous. Two independent managers cannot act on the same task.
4. Discord rendering re-queries canonical Factory Floor state and treats events as refresh signals rather than truth.
5. Backend selection is operator-visible and no unavailable Factory Floor request silently falls back to local execution.
6. Restart recovery reconciles Factory Floor state instead of inventing local transitions.
7. Existing `local_provider` tasks remain readable and resumable under their original contract until an explicit retention or retirement decision.
8. Deterministic consumer/provider contract tests pass in both repositories.

A flag-day rewrite is not required. New tasks may opt into a Factory Floor backend after these gates are met while historical local tasks retain their original identity.

## Priority risk register

| Priority | Risk | Current response |
|---|---|---|
| P0 | Invalid PM component data could silently select option zero | Controls now reject malformed, stale or out-of-range values and record no decision |
| P1 | Durable tasks did not identify their execution authority | Migration 14 and task-card rendering make `local_provider` explicit |
| P1 | Local and Factory Floor runtime concepts can drift into duplicate authority | Factory Floor Activity persistence remains linkage/projection only; direct task migration is gated |
| P1 | `TaskCoordinator` combines Discord workflow and execution mechanics | Retained as compatibility behavior pending a real operator-client contract |
| P1 | Local usage admission may encode provider-runtime policy in the presentation product | Owner decision remains open; no move is implied by this review |
| P2 | Provider-specific capability differences can be hidden by a uniform interface | Keep adapters local until per-provider Factory Floor capability parity is demonstrated |
| P2 | Worktree ownership could split across two managers | No Factory Floor backend may use the local worktree creation path |

## Owner decisions

The following questions remain intentionally unresolved:

1. Is the PM-style primary agent a Discord-only interface role, a generic operator assistant, or a future canonical Engineering Agent Team definition? It must not be silently identified as Iris.
2. Should usage admission become Factory Floor execution policy, remain a local advisory product feature, or be split into both with distinct authority?
3. Will Factory Floor workers own Git worktrees, consume externally prepared workspaces, or use another repository-access contract?
4. Which provider session capabilities must survive migration, especially continuation, approvals, user questions, cancellation and provider-specific settings?
5. What retention period applies to local provider events, results, reservations and worktrees after new task creation moves to Factory Floor?
6. Should reusable operator-client packages live in Factory Floor, Discord Agent, or a separately governed package repository after a second consumer exists?

These decisions require owner or cross-repository agreement. Discord Agent must not infer answers from its historical implementation.

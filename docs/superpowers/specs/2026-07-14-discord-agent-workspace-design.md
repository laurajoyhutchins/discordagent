# Discord Agent Workspace Design

**Date:** 2026-07-14  
**Status:** Approved  
**Upstream:** `NicolaiLolansen/DiscordClaude`  
**Target:** `laurajoyhutchins/discordagent`

## Purpose

Evolve DiscordClaude into a provider-neutral, private Discord workspace with:

- one persistent primary agent acting as the user’s project owner / project manager;
- isolated Claude or Codex task subagents represented by Discord threads;
- one Git branch and worktree for every Git-backed task;
- deterministic authentication, approvals, recovery, memory, and usage-aware task admission.

The server is private and contains the owner and trusted agents. Public multi-tenant hosting is not part of the first release.

## Product model

### Primary agent

The primary agent lives in a normal `#agent-chat` channel. The user talks to it naturally rather than operating the system primarily through slash commands. It:

- discusses priorities and project direction;
- remembers durable user and project facts;
- knows active tasks and their outcomes;
- proposes and delegates bounded work;
- gathers decisions through text, buttons, menus, or polls;
- summarizes results at a project-owner level;
- manages context and provider usage quietly.

It should not badger the user with token counts, context-window details, or routine telemetry. It surfaces usage only when a task is unusually expensive, cannot be completed reliably, is at risk, needs scope reduction, or the user explicitly asks.

### Task subagents

Every coding task maps to exactly one:

- Discord task thread;
- immutable provider identity (`claude` or `codex`);
- provider session identifier;
- repository and Git worktree;
- Git branch;
- usage reservation;
- structured completion or checkpoint record.

Task threads contain detailed progress, command activity, file changes, approvals, and verification. The primary chat receives concise outcomes and decisions rather than raw logs.

## Discord experience

Recommended server layout:

```text
Server
├── #agent-chat
├── #usage                 optional detailed telemetry
└── Project categories
    ├── factory-floor
    │   └── #agent
    └── reading
        └── #agent
```

New project channels are provider-neutral `#agent` channels. Existing `#claude` channel mappings migrate without losing registrations and may be renamed opportunistically.

Use the narrowest suitable Discord interaction:

- **Buttons:** approve, deny, start, stop, retry, resume, switch provider.
- **Select menus:** immediate single-choice decisions.
- **Native polls:** deliberative choices that may remain open.
- **Free text:** ordinary conversation and nuanced requirements.

A poll result is never treated as authorization for a destructive action unless the user explicitly confirms execution.

## Provider architecture

Discord handlers depend on a provider-neutral coordinator, not directly on either SDK.

```ts
export type AgentProviderId = 'claude' | 'codex';

export interface AgentProvider {
  readonly id: AgentProviderId;
  checkAvailability(): Promise<ProviderAvailability>;
  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  cancelTask(sessionId: string): Promise<void>;
  estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate>;
}

export interface ProviderRun {
  session: ProviderSession;
  completion: Promise<TaskResult>;
}
```

`startTask` resolves as soon as the provider session exists. The coordinator persists that session before awaiting completion, so a process interruption cannot lose the resume identifier.

Providers emit normalized events:

```ts
export type AgentEvent =
  | { type: 'session_started'; session: ProviderSession }
  | { type: 'text_delta'; text: string }
  | { type: 'status'; phase: string; detail?: string }
  | { type: 'plan'; items: PlanItem[] }
  | { type: 'command'; command: string; state: ToolState }
  | { type: 'file_change'; paths: string[]; summary?: string }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'user_question'; question: UserQuestion }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'completed'; result: TaskResult }
  | { type: 'failed'; error: NormalizedAgentError };
```

Discord rendering, persistence, worktree lifecycle, recovery, and usage policy operate on these events.

### Claude provider

Move the existing Claude Agent SDK behavior behind `ClaudeProvider` while preserving:

- streaming;
- session continuation;
- tool approval;
- user questions;
- cancellation;
- model selection;
- user-level settings isolation;
- existing usage capture.

Claude remains usable throughout every implementation phase.

### Codex provider

Implement Codex through **Codex App Server**. The adapter owns:

- process launch and restart;
- JSON-RPC initialization and capability negotiation;
- account and authentication state;
- thread creation, resume, and fork;
- turn submission and cancellation;
- streamed text, plans, commands, file changes, and token usage;
- command/file-change approvals and user-input requests;
- rate-limit updates and deterministic recovery.

Do not parse terminal presentation output as the integration protocol.

## Provider selection and handoff

Each project stores a default provider, changed with:

```text
/provider claude
/provider codex
```

A new task inherits the project default. A one-shot override may be supplied without changing the project. Provider identity is immutable inside a task because Claude and Codex session histories are not interchangeable.

When the user requests a provider switch in an active thread:

1. estimate the rough context/token cost and confidence;
2. explain that a fresh provider session and handoff summary are required;
3. request confirmation;
4. create a sibling Discord thread after approval;
5. create a fresh provider session and isolated worktree derived from the current task branch unless the user chooses another base;
6. post reciprocal links between threads;
7. pass a structured handoff containing objective, decisions, repository state, verification, completed work, unresolved work, and source-thread links;
8. do not copy the entire transcript by default.

## Git worktree isolation

Every Git-backed task receives a dedicated branch and worktree before provider execution begins.

```text
agent/<provider>/<task-slug>-<short-thread-id>
```

Task creation must:

1. validate the registered repository;
2. resolve the configured base branch;
3. reject unsafe in-progress Git operations;
4. create a deterministic collision-resistant branch and worktree;
5. persist task/worktree mappings transactionally;
6. only then start the provider.

Concurrent tasks never share a writable checkout. Worktrees remain until the task is merged, explicitly closed, or safely cleaned. The system never force-deletes, resets, or removes a worktree containing uncommitted work.

Optional non-Git support may remain for Claude compatibility with a clear warning. Codex tasks for non-Git directories remain disabled by default.

## Codex authentication onboarding

Authentication is an explicit state machine driven by App Server account state:

```text
unknown → checking → ready
                  ↘ authentication_required
                    → awaiting_user → verifying
                    → ready | failed | cancelled
```

When authentication is required:

- do not start the task or modify the repository;
- present **Sign in with ChatGPT**, **Check again**, and **Cancel** privately;
- use device-code login so the browser may be on another device;
- show the verification URL and one-time code only in an ephemeral interaction or DM;
- verify completion with a fresh account read;
- require explicit **Start task** after authentication.

Only the allowlisted human may initiate login/logout. Agent accounts cannot. API keys are never requested through Discord. Login IDs and one-time codes remain in memory only, are redacted from logs, and expire deterministically. If device login is unavailable, instruct the user to run `codex login` or `codex login --device-auth` locally and then select **Check again**.

If authentication expires during work, preserve the worktree and checkpoint, report whether side effects occurred, reauthenticate, and offer **Retry turn**. Never automatically replay a partially executed turn.

## Primary-agent memory

Use Letta- and Hermes-inspired patterns without making either runtime a dependency.

### Pinned memory

Small named records are available on every primary-agent turn:

- identity and authorization policy;
- user preferences;
- active goals and projects;
- open decisions;
- active agents;
- usage posture;
- recent commitments.

Security policy, repository allowlists, and authentication rules are read-only. Goals, project status, and preferences are agent-maintained with provenance.

### Full journal and retrieval

Persist every message, interaction, task event, and result in SQLite. Use SQLite FTS5 for deterministic local retrieval. Raw messages remain authoritative; summaries are navigation aids.

### Durable memory

Promoted memories store source, confidence, timestamps, and revisions. Direct user statements and verified task results may update memory. Repository/web/email content cannot directly rewrite durable user memory. Conflicts create reconciliation records rather than silent overwrites.

### Context assembly

Each primary-agent turn contains:

```text
system instructions
+ pinned memory
+ active task and usage state
+ recent conversation window
+ relevant retrieved history
+ unresolved decisions
```

Older conversation is checkpointed and searchable. Repository instructions load progressively rather than placing all repository context in every turn.

## Usage-aware orchestration

Track provider rate limits, reset windows, token usage, active reservations, historical task costs, and task progress. Treat estimates as ranges, never guarantees.

A task is admitted only when it can likely be completed and verified while preserving enough capacity for the primary agent. Internal decisions are:

- can complete confidently;
- can complete if narrowed;
- should defer;
- should switch provider;
- requires approval because expected cost is unusually high.

Normal messages omit usage telemetry. The agent escalates practical consequences and recommendations only.

When capacity becomes constrained:

1. stop admitting new large tasks;
2. eliminate optional retries and redundant reviews;
3. narrow work and reduce nonessential updates;
4. prefer bounded investigation or planning;
5. ask before changing provider, model, scope, or quality;
6. checkpoint after a safe atomic operation;
7. preserve branch, worktree, verification state, and an exact continuation prompt.

Never silently switch providers, reduce reasoning quality, consume special credits, replay partial turns, or abandon uncommitted work.

## Persistence

SQLite is the durable operational store. Minimum entities:

```text
projects
tasks
worktrees
provider_sessions
task_events
task_results
messages + FTS5
interactions
memory_records
memory_revisions
usage_snapshots
usage_reservations
pending_auth_flows
```

Required invariants:

- one task maps to one Discord thread;
- one task has one immutable provider;
- one Git task has one writable worktree;
- provider session IDs are provider-scoped;
- task, worktree, and session mappings are stored before execution continues;
- provider event writes are idempotent;
- sensitive credentials are never persisted.

Existing `projects.json` data migrates once. `claudeChannelId` maps to `agentChannelId`; the old model maps to Claude’s provider-scoped model; old session IDs are retained only as legacy metadata and are not resumed automatically. Roborev webhook tokens are not migrated into SQLite.

Project removal is a soft archive so historical tasks retain referential integrity. Re-adding the same project reactivates or replaces the registration deterministically.

## Error handling and recovery

- Provider termination marks turns **interrupted**, not completed.
- Preserve provider sessions and worktrees, restart with bounded retries, and offer deterministic resume/retry controls.
- Never automatically replay a turn that may have side effects.
- Preserve the existing single-instance lock and Discord gateway watchdog.
- Store important state before posting confirmation to Discord.
- Coalesce streaming updates to respect Discord rate limits.
- Detect dirty bases, locked worktrees, branch collisions, and in-progress Git operations.
- Continue with reduced historical context if FTS retrieval fails; never invent missing memory.

## Commands

Initial administrative surface:

```text
/add-project
/list-projects
/remove-project
/provider [claude|codex]
/model [...]
/agents
/usage
/cancel
/loop
/stop-loop
/codex-auth status|login|logout
```

Natural language remains the default interface.

## Testing

### Unit

Test provider normalization, provider immutability, selection precedence, authentication transitions, handoff confirmation, usage admission, worktree guards, memory provenance/conflicts, legacy migration, and Discord authorization.

### Integration

Use fake provider transports for streaming, approvals, questions, cancellation, restart/resume, auth expiry, rate-limit changes, checkpoints, sibling handoffs, and Discord retries. Use real temporary Git repositories for worktree tests.

### Contract

Keep fixtures for Claude SDK and Codex App Server messages. Fail clearly on incompatible upstream protocol changes.

### End-to-end smoke

In a private test server: register a repo, authenticate Codex, select provider, start a natural-language task, approve an action, continue in-thread, hand off to a sibling provider thread, checkpoint, restart the bot, recover state, and inspect `/agents` and `/usage`.

## Delivery phases

1. **Provider-neutral foundation:** attribution, tests, domain contracts, SQLite, legacy migration, worktrees, `ClaudeProvider`, coordinator, provider-neutral Discord UI.
2. **Codex App Server:** transport/process manager, auth onboarding, Codex events/approvals/questions/cancellation/usage/recovery, provider handoff.
3. **Primary agent workspace:** `#agent-chat`, journal/FTS, durable memory, context assembly, delegation, structured reporting, polls.
4. **Usage-aware orchestration:** calibration, reservation ledger, admission policy, graceful degradation, exception-driven disclosure.

Each phase leaves the existing Claude workflow usable.

## Security baseline

- Allowlist guild, channels, roles, and the authorized human user.
- Keep provider credentials out of Discord and application persistence.
- Restrict registered repositories to a configured base directory.
- Use isolated worktrees.
- Require provider-appropriate approval for consequential actions.
- Treat repository content and agent output as untrusted.
- Do not allow project-local configuration to weaken global authorization.
- Redact secrets from logs and Discord output.
- Disable automatic merge, deployment, destructive cleanup, and silent provider switching.

## Success criteria

The user can converse naturally with one persistent PM-style agent; delegate work into isolated Claude or Codex threads; authenticate Codex safely; answer questions through native Discord controls; switch providers through confirmed sibling handoffs; recover after restart; receive concise outcome-focused updates; and avoid starting tasks that are unlikely to finish within available provider capacity.

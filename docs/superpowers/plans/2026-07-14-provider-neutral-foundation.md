# Provider-Neutral Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver Phase 1 of the approved Discord Agent Workspace design: preserve the current Claude workflow while introducing provider-neutral task/session boundaries, durable SQLite state, one worktree per Git task, and a coordinator that later supports Codex App Server.

**Architecture:** Keep DiscordClaude working while replacing direct handler-to-Claude coupling with four explicit boundaries: domain contracts, repositories, worktree management, and provider adapters. `TaskCoordinator` owns task lifecycle and persistence; `ClaudeProvider` wraps the existing Agent SDK; Discord renders normalized events. Codex, primary-agent memory, and usage admission are separate later plans.

**Tech stack:** Node.js 22+, TypeScript ES2022 modules, discord.js 14, `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, Vitest, Git CLI invoked with `execFile`, GitHub Actions.

## Global constraints

- Preserve the upstream MIT license and attribution.
- Keep Claude usable after every task and commit.
- New project channels are named `#agent`; existing `#claude` mappings continue to work.
- Each Git-backed task receives one isolated branch and worktree before provider execution.
- Provider identity is immutable for a task.
- Persist task, worktree, and provider-session identity before awaiting a provider turn.
- Never persist provider credentials, device codes, API keys, or Roborev webhook tokens.
- Never force-reset, force-delete, or silently discard user work.
- Continue using user-level Claude settings only; project/local Claude settings remain ignored.
- Routine completion messages do not surface token, cost, or quota telemetry.
- All new behavior is tested before implementation and committed in reviewable increments.

## Scope boundary

This plan implements only **Phase 1: Provider-Neutral Foundation**. Follow-on plans will cover:

1. Codex App Server adapter and authentication.
2. Persistent primary-agent workspace, memory, and Discord polls.
3. Usage-aware admission, reservations, and graceful degradation.

Phase 1 may expose `codex` as a known provider identifier, but it must refuse Codex task execution cleanly until Phase 2 is installed.

## Target file map

```text
.github/workflows/ci.yml
src/
  agents/
    contracts.ts
    providerRegistry.ts
    claude/
      claudeProvider.ts
      claudeEventAdapter.ts
  commands/
    provider.ts
  coordinator/
    taskCoordinator.ts
    taskRecovery.ts
  db/
    database.ts
    migrations.ts
    schema.ts
  discord/
    interactionBroker.ts
    taskRenderer.ts
  git/
    gitClient.ts
    worktreeManager.ts
  repositories/
    projectRepository.ts
    taskRepository.ts
    eventRepository.ts
    legacyProjectImporter.ts
  services/
    runtime.ts
  test/
    fixtures/
  types.ts
```

Existing handlers, commands, `loopRunner.ts`, `usageTracker.ts`, and `roborevWatcher.ts` are adapted rather than replaced all at once.

---

## Task 1: Establish the test and CI baseline

**Files**

- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.github/workflows/ci.yml`
- Create: `src/test/smoke.test.ts`

**Produces**

- `npm test`
- `npm run test:watch`
- Node 22 CI running tests and TypeScript build.

- [ ] Add `vitest`, `@vitest/coverage-v8`, and `better-sqlite3` plus its TypeScript types.
- [ ] Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "check": "npm test && npm run build"
}
```

- [ ] Configure Vitest for Node, test files under `src/**/*.test.ts`, and deterministic single-process DB tests.
- [ ] Add a smoke test importing the current command definitions and asserting at least one command is registered.
- [ ] Run `npm test`; expect PASS.
- [ ] Run `npm run build`; expect PASS.
- [ ] Add GitHub Actions using `actions/setup-node` with Node 22, `npm ci`, `npm test`, and `npm run build`.
- [ ] Commit:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .github/workflows/ci.yml src/test/smoke.test.ts
git commit -m "test: add Vitest and CI baseline"
```

**Acceptance:** Existing source builds unchanged and CI can verify subsequent tasks.

---

## Task 2: Define provider-neutral domain contracts

**Files**

- Create: `src/agents/contracts.ts`
- Modify: `src/types.ts`
- Create: `src/agents/contracts.test.ts`

**Produces**

```ts
export type AgentProviderId = 'claude' | 'codex';
export type TaskStatus = 'created' | 'starting' | 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface ProviderSession {
  provider: AgentProviderId;
  sessionId: string;
  createdAt: number;
}

export interface ProviderRun {
  session: ProviderSession;
  completion: Promise<TaskResult>;
}

export interface AgentRunHost {
  emit(event: AgentEvent): Promise<void>;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  requestUserInput(request: UserQuestion): Promise<UserAnswer>;
}

export interface AgentProvider {
  readonly id: AgentProviderId;
  checkAvailability(): Promise<ProviderAvailability>;
  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  cancelTask(sessionId: string): Promise<void>;
  estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate>;
}
```

`AgentEvent` includes `session_started`, `text_delta`, `status`, `plan`, `command`, `file_change`, `approval_request`, `user_question`, `usage`, `completed`, and `failed` variants.

- [ ] Write type-level and runtime guard tests for provider IDs, task states, event variants, and provider-scoped sessions.
- [ ] Replace `Project.claudeChannelId` in the domain model with `agentChannelId` while retaining an importer-only legacy shape.
- [ ] Add provider-scoped models:

```ts
models?: Partial<Record<AgentProviderId, string>>;
defaultProvider: AgentProviderId;
```

- [ ] Add durable task/worktree/result interfaces with timestamps and immutable provider identity.
- [ ] Run `npm test -- src/agents/contracts.test.ts`; expect PASS.
- [ ] Run `npm run build`; expect PASS.
- [ ] Commit:

```bash
git add src/agents/contracts.ts src/agents/contracts.test.ts src/types.ts
git commit -m "refactor: define provider-neutral agent contracts"
```

**Acceptance:** No Discord or SDK type leaks into the domain contracts.

---

## Task 3: Add SQLite schema and migration runner

**Files**

- Create: `src/db/schema.ts`
- Create: `src/db/database.ts`
- Create: `src/db/migrations.ts`
- Create: `src/db/database.test.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`

**Produces**

```ts
export interface DatabaseHandle {
  readonly raw: import('better-sqlite3').Database;
  close(): void;
}

export function openDatabase(path?: string): DatabaseHandle;
export function runMigrations(db: DatabaseHandle): void;
```

- [ ] Add `DATABASE_PATH`, defaulting to `src/data/discordagent.sqlite` in development and the compiled data directory in production.
- [ ] Create versioned migrations inside a transaction.
- [ ] Create tables: `schema_migrations`, `projects`, `tasks`, `worktrees`, `provider_sessions`, `task_events`, `task_results`, `messages`, `interactions`, `memory_records`, `memory_revisions`, `usage_snapshots`, `usage_reservations`, and `pending_auth_flows`.
- [ ] Add `messages_fts` using FTS5 plus insert/update/delete synchronization triggers.
- [ ] Add uniqueness constraints:
  - one active project name;
  - one task per Discord thread;
  - one worktree per task;
  - provider/session composite uniqueness;
  - event deduplication key per task.
- [ ] Add foreign keys and enable `foreign_keys`, WAL, and a busy timeout.
- [ ] Test idempotent migration, rollback on failure, FTS synchronization, and all uniqueness constraints using temporary database files.
- [ ] Run `npm test -- src/db/database.test.ts`; expect PASS.
- [ ] Commit:

```bash
git add src/db src/config.ts .env.example package.json package-lock.json
git commit -m "feat: add SQLite operational store"
```

**Acceptance:** Opening an empty DB deterministically creates the complete Phase 1 schema; reopening changes nothing.

---

## Task 4: Replace project JSON persistence with a repository and one-time importer

**Files**

- Create: `src/repositories/projectRepository.ts`
- Create: `src/repositories/legacyProjectImporter.ts`
- Create: `src/repositories/projectRepository.test.ts`
- Modify: `src/services/projectStore.ts`
- Modify: `src/types.ts`

**Produces**

```ts
export interface ProjectRepository {
  listActive(): Project[];
  findByName(name: string): Project | undefined;
  findByChannelId(channelId: string): Project | undefined;
  create(project: NewProject): Project;
  updateDefaultProvider(name: string, provider: AgentProviderId): Project;
  updateModel(name: string, provider: AgentProviderId, model?: string): Project;
  archive(name: string): Project | undefined;
}

export function importLegacyProjects(db: DatabaseHandle, jsonPath: string): LegacyImportResult;
```

- [ ] Write failing tests for CRUD, channel lookup, provider/model updates, soft archive, and deterministic reactivation.
- [ ] Import legacy fields as follows:
  - `claudeChannelId` → `agentChannelId`;
  - `model` → `models.claude`;
  - provider defaults to `claude`;
  - `sessionId` is recorded only in importer metadata and never auto-resumed;
  - Roborev webhook tokens are ignored and never written to SQLite or logs.
- [ ] Make import idempotent using a migration/import marker.
- [ ] Keep `projectStore.ts` temporarily as a compatibility facade backed by `ProjectRepository` so intermediate commits build.
- [ ] Test malformed JSON, duplicate project names, archived projects, and missing files.
- [ ] Run `npm test -- src/repositories/projectRepository.test.ts`; expect PASS.
- [ ] Commit:

```bash
git add src/repositories src/services/projectStore.ts src/types.ts
git commit -m "feat: persist projects in SQLite"
```

**Acceptance:** Existing installations retain project/channel mappings without retaining provider credentials.

---

## Task 5: Implement guarded Git worktree management

**Files**

- Create: `src/git/gitClient.ts`
- Create: `src/git/worktreeManager.ts`
- Create: `src/git/worktreeManager.test.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`

**Produces**

```ts
export interface GitClient {
  run(cwd: string, args: readonly string[]): Promise<GitResult>;
}

export interface WorktreeManager {
  create(input: CreateWorktreeInput): Promise<CreatedWorktree>;
  inspect(path: string): Promise<WorktreeInspection>;
  remove(input: RemoveWorktreeInput): Promise<void>;
  pruneAdministrativeMetadata(repoPath: string): Promise<void>;
}
```

- [ ] Invoke Git only through `execFile('git', args, { shell: false })`.
- [ ] Add `WORKTREES_BASE_DIR`; default to a sibling `discordagent-worktrees` directory beneath the configured data directory.
- [ ] Generate branch names as `agent/<provider>/<slug>-<last6ThreadId>` with a task-ID suffix on collision.
- [ ] Resolve the project’s configured base branch, otherwise the symbolic default branch, otherwise current branch.
- [ ] Reject repositories with rebase, merge, cherry-pick, or bisect operations in progress.
- [ ] Reject missing remotes/defaults only when the selected operation requires them; local-only repos remain supported.
- [ ] Never use `--force` for branch deletion, worktree removal, reset, or checkout.
- [ ] Refuse worktree removal when `git status --porcelain` is nonempty.
- [ ] Test against real temporary Git repositories: creation, collision, concurrency, dirty worktree removal refusal, branch base, and paths containing spaces.
- [ ] Run `npm test -- src/git/worktreeManager.test.ts`; expect PASS.
- [ ] Commit:

```bash
git add src/git src/config.ts .env.example
git commit -m "feat: add isolated task worktrees"
```

**Acceptance:** Two concurrent tasks never receive the same writable checkout or branch.

---

## Task 6: Add task, session, worktree, event, and result repositories

**Files**

- Create: `src/repositories/taskRepository.ts`
- Create: `src/repositories/eventRepository.ts`
- Create: `src/repositories/taskRepository.test.ts`

**Produces**

```ts
export interface TaskRepository {
  createWithWorktree(input: CreateTaskTransaction): TaskRecord;
  attachProviderSession(taskId: string, session: ProviderSession): void;
  transition(taskId: string, expected: readonly TaskStatus[], next: TaskStatus): TaskRecord;
  findByThreadId(threadId: string): TaskRecord | undefined;
  listRecoverable(): TaskRecord[];
  saveResult(taskId: string, result: TaskResult): void;
}

export interface EventRepository {
  append(taskId: string, event: AgentEvent, dedupeKey?: string): void;
  list(taskId: string): StoredTaskEvent[];
}
```

- [ ] Test transactional `task + worktree` creation and rollback.
- [ ] Test immutable provider identity.
- [ ] Test that a provider session can be attached once and only to the matching provider.
- [ ] Define legal state transitions and reject stale compare-and-set updates.
- [ ] Make event writes idempotent when a dedupe key is supplied.
- [ ] Store results separately from events and ensure only terminal tasks receive terminal results.
- [ ] Query recoverable tasks in `starting`, `running`, or `waiting_for_user` state.
- [ ] Run `npm test -- src/repositories/taskRepository.test.ts`; expect PASS.
- [ ] Commit:

```bash
git add src/repositories/taskRepository.ts src/repositories/eventRepository.ts src/repositories/taskRepository.test.ts
git commit -m "feat: persist task lifecycle and provider sessions"
```

**Acceptance:** Process interruption cannot erase the task/worktree/session mapping.

---

## Task 7: Introduce ProviderRegistry and wrap Claude as ClaudeProvider

**Files**

- Create: `src/agents/providerRegistry.ts`
- Create: `src/agents/providerRegistry.test.ts`
- Create: `src/agents/claude/claudeEventAdapter.ts`
- Create: `src/agents/claude/claudeProvider.ts`
- Create: `src/agents/claude/claudeProvider.test.ts`
- Modify: `src/services/claudeRunner.ts`
- Modify: `src/config.ts`

**Produces**

```ts
export class ProviderRegistry {
  register(provider: AgentProvider): void;
  require(id: AgentProviderId): AgentProvider;
  availability(id: AgentProviderId): Promise<ProviderAvailability>;
}
```

- [ ] Test duplicate registration, missing provider, and deterministic provider lookup.
- [ ] Move Claude query construction, model resolution, environment sanitization, tool approval, session resume, cancellation, and result parsing into `ClaudeProvider`.
- [ ] Normalize Claude SDK messages through `claudeEventAdapter.ts`.
- [ ] Emit `session_started` and resolve `ProviderRun.session` immediately after the SDK supplies the session ID; do not wait for the final result.
- [ ] Translate Claude rate-limit and usage events into normalized usage events while preserving the existing usage tracker during migration.
- [ ] Keep `settingSources: ['user']`.
- [ ] Make `claudeRunner.ts` a temporary compatibility wrapper that delegates to `ClaudeProvider`, then delete it in Task 12.
- [ ] Use a fake async message stream to test text, tool approvals, user questions, usage, success, cancellation, resume, and malformed events.
- [ ] Run `npm test -- src/agents`; expect PASS.
- [ ] Run `npm run build`; expect PASS.
- [ ] Commit:

```bash
git add src/agents src/services/claudeRunner.ts src/config.ts
git commit -m "refactor: wrap Claude behind agent provider interface"
```

**Acceptance:** Current Claude functionality remains behaviorally equivalent through the new provider contract.

---

## Task 8: Build provider-neutral Discord rendering and interaction brokering

**Files**

- Create: `src/discord/taskRenderer.ts`
- Create: `src/discord/interactionBroker.ts`
- Create: `src/discord/taskRenderer.test.ts`
- Modify: `src/services/discordStreamer.ts`
- Modify: `src/handlers/interactionHandler.ts`

**Produces**

```ts
export interface TaskRenderer {
  start(thread: AnyThreadChannel): void;
  handle(event: AgentEvent): Promise<void>;
  finish(result: TaskResult): Promise<void>;
}

export interface InteractionBroker {
  requestApproval(thread: AnyThreadChannel, request: ApprovalRequest): Promise<ApprovalDecision>;
  requestUserInput(thread: AnyThreadChannel, question: UserQuestion): Promise<UserAnswer>;
}
```

- [ ] Test rendering of all event variants without provider-specific labels.
- [ ] Preserve throttled/coalesced text editing and Discord-safe chunking.
- [ ] Generate collision-resistant custom IDs containing task/request identity rather than global IDs such as `tool_allow`.
- [ ] Retain collect-then-verify authorization; only authorized humans may resolve approvals/questions.
- [ ] On timeout, deny consequential approvals and return an explicit timeout/skip for questions. Never silently choose the first option.
- [ ] Keep normal completion output concise: outcome, branch, verification, unresolved decisions. Hide routine token/cost telemetry.
- [ ] Make `discordStreamer.ts` a compatibility facade until Task 12.
- [ ] Run `npm test -- src/discord`; expect PASS.
- [ ] Commit:

```bash
git add src/discord src/services/discordStreamer.ts src/handlers/interactionHandler.ts
git commit -m "refactor: render provider-neutral task events"
```

**Acceptance:** Discord presentation no longer assumes Claude while preserving approvals and streaming.

---

## Task 9: Implement the durable TaskCoordinator

**Files**

- Create: `src/coordinator/taskCoordinator.ts`
- Create: `src/coordinator/taskCoordinator.test.ts`
- Create: `src/coordinator/taskRecovery.ts`

**Produces**

```ts
export interface TaskCoordinator {
  startFromMessage(input: StartFromMessageInput): Promise<TaskRecord>;
  startInExistingThread(input: StartInThreadInput): Promise<TaskRecord>;
  continueFromMessage(input: ContinueFromMessageInput): Promise<void>;
  continueInThread(input: ContinueInThreadInput): Promise<void>;
  cancelByThread(threadId: string): Promise<boolean>;
  closeTask(taskId: string): Promise<void>;
  recoverInterruptedTasks(): Promise<TaskRecord[]>;
}
```

- [ ] Test start ordering with fakes. Required order:
  1. validate project/provider;
  2. create Discord thread when needed;
  3. create Git branch/worktree;
  4. persist task/worktree transaction;
  5. transition to `starting`;
  6. call provider;
  7. persist provider session immediately;
  8. transition to `running`;
  9. await completion;
  10. store result and terminal state.
- [ ] If provider availability fails before execution, preserve no half-created worktree unless a task record exists and clearly reports cleanup state.
- [ ] Route normalized events to both `EventRepository` and `TaskRenderer`.
- [ ] On approval/question, transition to and from `waiting_for_user` without losing the provider session.
- [ ] Cancellation invokes provider cancel, preserves worktree, and marks the task cancelled.
- [ ] Recovery marks nonterminal tasks `interrupted`, inspects worktree state, and offers resume rather than replaying automatically.
- [ ] Continuations require the existing task provider; reject provider changes and defer sibling handoff to Phase 2.
- [ ] Run `npm test -- src/coordinator`; expect PASS.
- [ ] Commit:

```bash
git add src/coordinator
git commit -m "feat: coordinate durable agent task lifecycle"
```

**Acceptance:** Coordinator tests prove state is durable before provider side effects and that interrupted work is never replayed automatically.

---

## Task 10: Adapt channels, commands, messages, loops, and Roborev

**Files**

- Create: `src/commands/provider.ts`
- Create: `src/commands/provider.test.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/addProject.ts`
- Modify: `src/commands/listProjects.ts`
- Modify: `src/commands/removeProject.ts`
- Modify: `src/commands/cancel.ts`
- Modify: `src/commands/model.ts`
- Modify: `src/handlers/messageHandler.ts`
- Modify: `src/handlers/interactionHandler.ts`
- Modify: `src/services/channelManager.ts`
- Modify: `src/services/loopRunner.ts`
- Modify: `src/services/roborevWatcher.ts`

- [ ] Change new project channel creation from `#claude` to `#agent`; map existing channel IDs without recreation.
- [ ] Add `/provider [claude|codex]`:
  - query current default when omitted;
  - set Claude when available;
  - refuse Codex with a clear “not installed until Phase 2” response and leave the project unchanged;
  - disallow changing provider from inside an existing task thread.
- [ ] Make `/model` provider-scoped. Existing choices continue to configure Claude.
- [ ] Route main-channel prompts through `TaskCoordinator.startFromMessage` and thread replies through `continueFromMessage`.
- [ ] Make `/cancel` call coordinator cancellation by task thread; main-channel cancellation remains explicit and scoped.
- [ ] Adapt loops so one loop owns one task/thread/worktree/session: first iteration uses `startInExistingThread`, later iterations use `continueInThread`.
- [ ] Keep loop non-overlap and minimum/maximum interval safeguards.
- [ ] Soft-archive projects on removal; channel deletion is still explicit.
- [ ] Replace Roborev webhook clients with normal bot-authenticated sends to the configured Roborev channel. Stop creating, storing, or DMing webhook URLs/tokens.
- [ ] Add handler tests for authorization, provider command behavior, channel routing, task thread continuation, and loop reuse.
- [ ] Run focused tests and `npm run build`; expect PASS.
- [ ] Commit:

```bash
git add src/commands src/handlers src/services/channelManager.ts src/services/loopRunner.ts src/services/roborevWatcher.ts
git commit -m "feat: route Discord tasks through provider-neutral coordinator"
```

**Acceptance:** A user can register a project, converse in `#agent`, run and continue Claude tasks in isolated worktrees, cancel them, and run loops without direct handler-to-SDK coupling.

---

## Task 11: Wire runtime startup, migration, and recovery

**Files**

- Create: `src/services/runtime.ts`
- Create: `src/services/runtime.test.ts`
- Modify: `src/index.ts`
- Modify: `src/config.ts`

**Produces**

```ts
export interface RuntimeServices {
  database: DatabaseHandle;
  projects: ProjectRepository;
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  coordinator: TaskCoordinator;
}

export function createRuntime(): RuntimeServices;
export async function startRuntime(client: Client): Promise<RuntimeServices>;
export async function stopRuntime(runtime: RuntimeServices): Promise<void>;
```

- [ ] Test startup ordering: configuration → DB → migrations → legacy import → repositories → Git manager → providers → coordinator → recovery → Discord listeners/watchers.
- [ ] Register only `ClaudeProvider` in Phase 1.
- [ ] Mark recoverable tasks interrupted and post a concise recovery message when the corresponding thread is available.
- [ ] Preserve the existing single-instance lock and gateway watchdog.
- [ ] Close DB/provider resources on SIGINT/SIGTERM after stopping loops and watchers.
- [ ] Ensure sensitive configuration is not printed in startup logs.
- [ ] Run `npm test -- src/services/runtime.test.ts`; expect PASS.
- [ ] Run `npm run build`; expect PASS.
- [ ] Commit:

```bash
git add src/services/runtime.ts src/services/runtime.test.ts src/index.ts src/config.ts
git commit -m "feat: initialize durable agent runtime"
```

**Acceptance:** Restarting the bot imports existing projects once and reports interrupted tasks without replaying them.

---

## Task 12: Remove compatibility layers, update documentation, and verify Phase 1

**Files**

- Delete: `src/services/claudeRunner.ts`
- Delete or reduce: `src/services/projectStore.ts`
- Delete or reduce: `src/services/discordStreamer.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.env.example`
- Modify: `package.json`
- Create: `docs/architecture/provider-neutral-runtime.md`

- [ ] Confirm no production imports reference compatibility wrappers.
- [ ] Remove obsolete Claude-specific names from generic paths, types, channel descriptions, and commands while retaining attribution and Claude provider documentation.
- [ ] Document:
  - architecture and lifecycle ordering;
  - SQLite location and migration behavior;
  - `#agent` channels;
  - `/provider` behavior;
  - worktree paths and cleanup safety;
  - recovery semantics;
  - Roborev’s bot-send integration;
  - Phase 1 limitation that Codex is not yet executable.
- [ ] Add a migration section for existing DiscordClaude users and explicitly state that old provider sessions are not auto-resumed.
- [ ] Run a placeholder/TODO scan:

```bash
grep -RInE 'TBD|TODO|placeholder|implement later' src docs README.md CLAUDE.md || true
```

Review every result; no incomplete implementation markers may remain.

- [ ] Run the complete verification suite:

```bash
npm ci
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] Run manual smoke checks in a temporary repository:
  1. register project;
  2. verify `#agent` channel;
  3. start two Claude tasks;
  4. verify different branches/worktrees;
  5. continue one thread;
  6. cancel the other;
  7. restart bot and verify no automatic replay;
  8. inspect DB and confirm no credentials/webhook tokens.
- [ ] Commit:

```bash
git add -A
git commit -m "docs: complete provider-neutral foundation"
```

**Acceptance:** Phase 1 is fully tested, documented, migration-safe, and keeps Claude operational through provider-neutral boundaries.

---

## Phase 1 review gate

Do not begin Codex App Server work until the Phase 1 PR confirms:

- all tests and build checks pass on Node 22;
- existing Claude tasks stream, approve, ask questions, continue, cancel, and report results;
- every Git task uses a unique worktree and branch;
- task/worktree/session identity survives restart;
- interrupted turns are not replayed automatically;
- legacy project registration migrates once;
- no provider credentials or Roborev webhook tokens are persisted;
- the Discord UI is provider-neutral;
- `/provider codex` fails safely until Phase 2.

## Follow-on plan names

After this gate, create and review:

- `docs/superpowers/plans/2026-07-14-codex-app-server-adapter.md`
- `docs/superpowers/plans/2026-07-14-primary-agent-workspace.md`
- `docs/superpowers/plans/2026-07-14-usage-aware-orchestration.md`

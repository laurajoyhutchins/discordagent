# OpenCode ACP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Add OpenCode as a durable project/task provider through the local 'opencode acp' CLI, with normalized streaming events, Discord approvals, session continuation, model selection, and safe runtime registration while deferring PM support.

**Architecture:** Add an OpenCode-specific ACP client wrapper around the official '@agentclientprotocol/sdk' and a separate event adapter. 'OpenCodeProvider' owns one ACP process per active task run and exposes only the existing 'AgentProvider' contract; runtime, coordinator, Discord, and persistence remain provider-neutral. OpenCode is registered only when ACP initialization is available, but it is excluded from PM onboarding and global PM activation until a restricted primary adapter exists.

**Tech Stack:** TypeScript ES2022 modules, Node.js 'child_process.spawn' with 'shell: false', '@agentclientprotocol/sdk' 1.2.1, Vitest, discord.js, existing SQLite repositories and task coordinator.

---

## File map

Create:

- 'src/agents/providerLabels.ts' — shared human-readable provider labels.
- 'src/agents/opencode/acpTransport.ts' — shell-free 'opencode acp' process and typed ACP client wrapper.
- 'src/agents/opencode/acpTransport.test.ts' — fake-process ACP lifecycle tests.
- 'src/agents/opencode/opencodeEventAdapter.ts' — ACP update/permission/result normalization.
- 'src/agents/opencode/opencodeEventAdapter.test.ts' — normalization and redaction fixtures.
- 'src/agents/opencode/opencodeProvider.ts' — 'AgentProvider' implementation and run lifecycle.
- 'src/agents/opencode/opencodeProvider.test.ts' — provider contract, continuation, cancellation, model, and failure tests.

Modify:

- 'package.json', 'package-lock.json' — add '@agentclientprotocol/sdk@1.2.1'.
- 'src/agents/contracts.ts' — add 'opencode' to the provider ID union.
- 'src/config.ts' — add OpenCode CLI path, enabled flag, model, and timeout configuration.
- 'src/services/runtime.ts' — construct/probe/register OpenCode and keep it out of PM activation.
- 'src/services/providerOnboarding.ts' — render only PM-capable providers and use shared labels.
- 'src/services/providerOnboarding.test.ts' — verify task-only OpenCode is not shown in PM onboarding.
- 'src/commands/provider.ts', 'src/commands/provider.test.ts' — use shared labels and explain PM scope.
- 'src/commands/usage.ts' — include OpenCode in provider-neutral usage display.
- 'src/commands/definitions.ts' — include 'opencode' in provider option choices/help text.
- 'src/commands/model.ts', 'src/commands/model.test.ts' — use provider-neutral model wording and OpenCode defaults.
- 'src/agents/contracts.test.ts' — recognize OpenCode as a valid provider ID.
- 'src/services/runtime.test.ts' — inject fake OpenCode providers and verify registration/PM exclusion.
- 'README.md', 'docs/architecture/provider-neutral-runtime.md' — document OpenCode CLI/ACP setup and task-only scope.

---

### Task 1: Add the OpenCode identity, dependency, and configuration

**Files:**
- Modify: 'package.json'
- Modify: 'package-lock.json'
- Modify: 'src/agents/contracts.ts'
- Modify: 'src/config.ts'
- Create: 'src/agents/providerLabels.ts'
- Test: 'src/agents/contracts.test.ts'

- [ ] **Step 1: Write the failing provider identity test**

Add to 'src/agents/contracts.test.ts':

~~~typescript
it('accepts OpenCode as a provider identifier', () => {
  expect(isAgentProviderId('opencode')).toBe(true);
  expect(AGENT_PROVIDER_IDS).toContain('opencode');
});
~~~

- [ ] **Step 2: Run the focused test and verify it fails**

Run: 'npm test -- src/agents/contracts.test.ts'

Expected: FAIL because 'opencode' is not in 'AGENT_PROVIDER_IDS'.

- [ ] **Step 3: Add the dependency and provider identity**

Run: 'npm install @agentclientprotocol/sdk@1.2.1'

Change 'src/agents/contracts.ts':

~~~typescript
export const AGENT_PROVIDER_IDS = ['claude', 'codex', 'opencode'] as const;
~~~

Create 'src/agents/providerLabels.ts':

~~~typescript
import type { AgentProviderId } from './contracts.js';

export function providerLabel(provider: AgentProviderId): string {
  return provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'OpenCode';
}
~~~

Add these config fields to 'src/config.ts':

~~~typescript
  openCodeCliPath: process.env.OPENCODE_CLI_PATH ?? 'opencode',
  openCodeEnabled: process.env.OPENCODE_ENABLED !== 'false',
  openCodeTimeoutMs: parseInt(process.env.OPENCODE_TIMEOUT_MS ?? '900000', 10),
  defaultOpenCodeModel: process.env.OPENCODE_MODEL ?? '',
~~~

- [ ] **Step 4: Run the focused test and build**

Run:

~~~text
npm test -- src/agents/contracts.test.ts
npm run build
~~~

Expected: the focused test passes and TypeScript compiles.

- [ ] **Step 5: Commit the identity/configuration slice**

~~~text
git add package.json package-lock.json src/agents/contracts.ts src/agents/contracts.test.ts src/agents/providerLabels.ts src/config.ts
git commit -m "feat: add OpenCode provider identity"
~~~

### Task 2: Build the typed ACP process transport

**Files:**
- Create: 'src/agents/opencode/acpTransport.ts'
- Test: 'src/agents/opencode/acpTransport.test.ts'

The transport wraps the official SDK's client-side connection over a Node child process. Use 'ClientSideConnection'/'ndJsonStream' or the equivalent typed 'client().connectWith(...)' API exposed by SDK 1.2.1; do not hand-roll a second JSON-RPC schema. The child process factory must be injectable for tests.

- [ ] **Step 1: Write the failing transport lifecycle tests**

Create a fake process that records stdin writes and exposes 'stdout', 'stderr', 'exit', and 'error' events. Add tests named:

~~~typescript
it('launches opencode acp through the shell-free invocation helper', async () => { /* assert command, ['acp'], and shell-free spawn options */ });
it('initializes ACP v1 with no filesystem or terminal callbacks advertised', async () => { /* assert initialize payload */ });
it('correlates session and prompt requests while routing updates to handlers', async () => { /* emit JSON-RPC responses/notifications and assert callbacks */ });
it('rejects pending operations and redacts stderr when the process exits', async () => { /* assert safe error and cleanup */ });
~~~

- [ ] **Step 2: Run the transport tests and verify the expected failures**

Run: 'npm test -- src/agents/opencode/acpTransport.test.ts'

Expected: FAIL because the transport module does not exist.

- [ ] **Step 3: Define the transport seam**

Export these types from 'src/agents/opencode/acpTransport.ts':

~~~typescript
export interface OpenCodeAcpHandlers {
  onSessionUpdate(params: unknown): Promise<void> | void;
  onPermission(params: unknown): Promise<unknown>;
}

export interface OpenCodeAcpConnection {
  initialize(): Promise<unknown>;
  newSession(cwd: string): Promise<unknown>;
  loadSession(sessionId: string, cwd: string): Promise<unknown>;
  resumeSession?(sessionId: string, cwd: string): Promise<unknown>;
  setSessionConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<unknown>;
  prompt(sessionId: string, text: string): Promise<unknown>;
  cancel(sessionId: string): Promise<void>;
  close(): Promise<void>;
}
~~~

The test process seam covers 'stdin.write/end', 'stdout.on(data)', 'stderr.on(data)', 'once(exit)', 'on(error)', and 'kill(signal)'. Use 'buildProcessInvocation(cliPath, ['acp'])' and spawn with '{ stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: process.env }'.

The initialize request advertises ACP v1 and client identity 'discord-agent'; omit 'fs' and 'terminal' capabilities. Preserve the handshake response so the provider can check 'loadSession', 'sessionCapabilities.resume', and returned configuration options.

- [ ] **Step 4: Implement the minimal typed transport and pass tests**

Implement request correlation, newline-delimited framing, redacted process errors, and the SDK method calls. 'close()' rejects and clears pending operations, ends stdin, and sends 'SIGTERM'. Do not add auto-approval, forced process killing, or fallback batch execution.

Run: 'npm test -- src/agents/opencode/acpTransport.test.ts'

Expected: all transport tests pass.

- [ ] **Step 5: Commit the transport slice**

~~~text
git add src/agents/opencode/acpTransport.ts src/agents/opencode/acpTransport.test.ts
git commit -m "feat: add OpenCode ACP transport"
~~~

### Task 3: Normalize ACP updates and permission requests

**Files:**
- Create: 'src/agents/opencode/opencodeEventAdapter.ts'
- Test: 'src/agents/opencode/opencodeEventAdapter.test.ts'

- [ ] **Step 1: Write failing adapter fixture tests**

Add fixtures for 'agent_message_chunk', 'agent_thought_chunk', 'plan', 'tool_call', 'tool_call_update', 'usage_update', unknown update, and 'session/request_permission'. Test names must include:

~~~typescript
it('maps agent message chunks to text deltas', () => { /* expect one text_delta */ });
it('maps execute tool updates to command states and output', () => { /* requested/running/completed/failed */ });
it('maps edit locations to file change paths', () => { /* absolute/relative path normalization */ });
it('maps plans and usage updates without leaking raw payloads', () => { /* normalized plan/usage */ });
it('maps allow, deny, and timeout to least-privileged ACP options', async () => { /* allow_once/reject_once */ });
it('turns malformed or unknown updates into safe status/error behavior', () => { /* no throw of raw payload */ });
~~~

- [ ] **Step 2: Run the adapter tests and verify they fail**

Run: 'npm test -- src/agents/opencode/opencodeEventAdapter.test.ts'

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Define normalization helpers**

Export functions with these signatures:

~~~typescript
export function adaptSessionUpdate(params: unknown): AgentEvent[];
export function approvalRequestFromAcp(params: unknown): ApprovalRequest;
export function permissionOutcome(decision: ApprovalDecision, options: readonly unknown[]): unknown;
export function taskResultFromPrompt(input: {
  provider: 'opencode';
  startedAt: number;
  completedAt: number;
  sessionId: string;
  promptResult: unknown;
  text: string;
}): TaskResult;
~~~

Map 'execute' to 'command', 'edit'/'delete'/'move' to 'file_change', and all other tool kinds to 'status'. Map 'allow' to an option whose ACP kind is 'allow_once'; map 'deny' and 'timeout' to 'reject_once'. If the exact option is absent, select no permissive option and return the reject option when present. Redact raw input/output before placing it in 'summary', 'detail', 'output', or errors using the existing redaction utilities.

- [ ] **Step 4: Implement the adapter and pass tests**

Ensure repeated 'tool_call_update' events produce state transitions without duplicate terminal events. Suppress thought content from Discord output unless an existing normalized event can represent it safely. Unknown session updates must not throw provider payloads into logs.

Run: 'npm test -- src/agents/opencode/opencodeEventAdapter.test.ts'

Expected: all adapter tests pass.

- [ ] **Step 5: Commit the adapter slice**

~~~text
git add src/agents/opencode/opencodeEventAdapter.ts src/agents/opencode/opencodeEventAdapter.test.ts
git commit -m "feat: normalize OpenCode ACP events"
~~~

### Task 4: Implement 'OpenCodeProvider'

**Files:**
- Create: 'src/agents/opencode/opencodeProvider.ts'
- Test: 'src/agents/opencode/opencodeProvider.test.ts'

- [ ] **Step 1: Write failing provider lifecycle tests**

Use an injected 'OpenCodeAcpConnection' factory and a fake 'AgentRunHost'. Add tests named:

~~~typescript
it('creates and emits the ACP session before the completion promise is awaited', async () => { /* session_started + completion */ });
it('continues only an OpenCode session and loads/resumes the persisted ID', async () => { /* reject Claude/Codex session; use advertised capability */ });
it('applies the requested model through the ACP model config option', async () => { /* setSessionConfigOption('model', requested) */ });
it('fails explicitly when the requested model is not advertised', async () => { /* no silent fallback */ });
it('routes ACP permission requests through the host approval broker', async () => { /* wait for host decision */ });
it('cancels the ACP prompt and cleans up the process', async () => { /* cancel(sessionId), close() */ });
it('normalizes authentication, protocol, process, and prompt failures', async () => { /* failed TaskResult + failed event */ });
~~~

- [ ] **Step 2: Run the provider tests and verify they fail**

Run: 'npm test -- src/agents/opencode/opencodeProvider.test.ts'

Expected: FAIL because 'OpenCodeProvider' does not exist.

- [ ] **Step 3: Implement provider options and availability**

Use this constructor shape:

~~~typescript
export interface OpenCodeProviderOptions {
  cliPath: string;
  timeoutMs: number;
  defaultModel?: string;
  resolveProjectModel?: (projectName: string) => string | undefined;
  createConnection: (handlers: OpenCodeAcpHandlers) => Promise<OpenCodeAcpConnection>;
  now?: () => number;
}
~~~

Set 'id = opencode as const'. 'checkAvailability()' creates an ACP connection, calls 'initialize()', requires protocol version 1, and closes the connection. It returns '{ available: false, reason }' for missing CLI, unsupported protocol, or authentication errors, with redacted reasons. It must not create a task session during the availability probe.

- [ ] **Step 4: Implement start/continue/cancel/handoff behavior**

For 'startTask', initialize, call 'newSession(input.workingDirectory)', extract a non-empty session ID, emit 'session_started', then return '{ session, completion }' before awaiting prompt completion. The completion coroutine sends the prompt, routes updates and permission requests through the adapter/host, and returns a redacted 'TaskResult' based on the ACP stop reason.

For 'continueTask', reject when 'input.session.provider !== opencode'. Prefer 'resumeSession' when advertised; otherwise use 'loadSession' only when 'loadSession' is advertised; otherwise return a failed run explaining that the saved session cannot be resumed. Use the session ID returned by the persisted session and reject if OpenCode returns a different ID.

For 'cancelTask', cancel the matching active connection and remove it from the active map after 'close()'. 'estimateHandoff' uses the existing deterministic formula: 'Math.ceil((summaryCharacters || transcriptCharacters) / 4) + changedFiles * 150', with 'medium' confidence when a summary exists and 'low' otherwise.

- [ ] **Step 5: Run provider tests and existing coordinator contract tests**

Run:

~~~text
npm test -- src/agents/opencode/opencodeProvider.test.ts src/coordinator/taskCoordinator.test.ts src/coordinator/handoff.test.ts
~~~

Expected: new provider tests pass. The existing runtime onboarding baseline failure may remain; record it separately and do not change its expected behavior to hide it.

- [ ] **Step 6: Commit the provider slice**

~~~text
git add src/agents/opencode/opencodeProvider.ts src/agents/opencode/opencodeProvider.test.ts
git commit -m "feat: add OpenCode task provider"
~~~

### Task 5: Register OpenCode safely and keep PM scope explicit

**Files:**
- Modify: 'src/services/runtime.ts'
- Modify: 'src/services/providerOnboarding.ts'
- Modify: 'src/services/providerOnboarding.test.ts'
- Modify: 'src/services/runtime.test.ts'
- Modify: 'src/commands/provider.ts'
- Modify: 'src/commands/provider.test.ts'

- [ ] **Step 1: Write failing runtime and onboarding tests**

Add tests for:

~~~typescript
it('registers an injected OpenCode provider when enabled', async () => { /* providers.require('opencode') */ });
it('omits OpenCode when its ACP availability probe fails', async () => { /* no provider registration */ });
it('does not show OpenCode in PM onboarding choices', async () => { /* buttons only Claude/Codex */ });
it('explains that OpenCode is task-only when selected for the PM', async () => { /* clear ephemeral error */ });
~~~

- [ ] **Step 2: Run these tests and verify the new expectations fail**

Run: 'npm test -- src/services/providerOnboarding.test.ts src/services/runtime.test.ts src/commands/provider.test.ts'

Expected: FAIL because runtime/onboarding do not know OpenCode or task-only PM scope.

- [ ] **Step 3: Add runtime options and registration**

Extend 'RuntimeOptions':

~~~typescript
  openCodeProvider?: AgentProvider;
  disableOpenCode?: boolean;
~~~

Before coordinator construction, create an 'OpenCodeProvider' when '!options.disableOpenCode && config.openCodeEnabled', pass the CLI path, timeout, default model, and 'projectName => projects.findByName(projectName)?.models?.opencode', then call 'checkAvailability()' before registering. If unavailable, log only the redacted reason and leave it unregistered. An injected provider is also availability-checked and must have 'id === opencode'.

Pass a PM-capable provider list (registered Claude/Codex entries) to 'createProviderOnboardingService'. Keep OpenCode in the general registry for project task selection but omit it from PM onboarding. When the global PM provider command receives 'opencode', return an ephemeral task-only explanation without changing settings.

- [ ] **Step 4: Implement shared labels and command behavior**

Replace duplicated ternaries in onboarding/provider command text with 'providerLabel(provider)'. Project-channel provider changes continue to allow OpenCode after its availability check. Task-thread handoffs accept OpenCode through the existing registry.

- [ ] **Step 5: Run focused tests and inspect the baseline failure**

Run: 'npm test -- src/services/providerOnboarding.test.ts src/services/runtime.test.ts src/commands/provider.test.ts'

Expected: new OpenCode tests pass. If the pre-existing onboarding test still fails, keep it visible and document its exact failure in the handoff.

- [ ] **Step 6: Commit runtime and PM-scope integration**

~~~text
git add src/services/runtime.ts src/services/providerOnboarding.ts src/services/providerOnboarding.test.ts src/services/runtime.test.ts src/commands/provider.ts src/commands/provider.test.ts src/agents/providerLabels.ts
git commit -m "feat: register OpenCode as a task provider"
~~~

### Task 6: Update commands, usage, model settings, and documentation

**Files:**
- Modify: 'src/commands/definitions.ts'
- Modify: 'src/commands/usage.ts'
- Modify: 'src/commands/model.ts'
- Modify: 'src/commands/model.test.ts'
- Modify: 'README.md'
- Modify: 'docs/architecture/provider-neutral-runtime.md'

- [ ] **Step 1: Write failing command/display tests**

Add assertions that:

~~~typescript
it('offers OpenCode in provider command choices', () => { /* inspect definition choices */ });
it('renders OpenCode in usage output', async () => { /* embed includes OpenCode */ });
it('describes model defaults without naming only Claude', async () => { /* generic provider-scoped copy */ });
~~~

- [ ] **Step 2: Run focused tests and verify failures**

Run: 'npm test -- src/commands/model.test.ts src/commands/provider.test.ts src/commands/inspection.test.ts'

Expected: failures identify hard-coded Claude/Codex labels or choices.

- [ ] **Step 3: Update command definitions and displays**

Add 'opencode' as a provider choice in 'src/commands/definitions.ts', iterate 'claude', 'codex', and 'opencode' in usage display, and use 'providerLabel' for display names. Keep the provider-scoped model repository shape so OpenCode is stored under 'models.opencode'.

- [ ] **Step 4: Document setup and scope**

Update README with:

~~~text
OpenCode is optional and runs through the local 'opencode acp' CLI. Install OpenCode and run 'opencode auth login' on the bot host before selecting OpenCode in a project channel. OpenCode task threads use ACP streaming, Discord approvals, and durable session continuation. PM-style #agent-chat support is not included yet.
~~~

Update the architecture diagram and provider section to include 'OpenCodeProvider → opencode acp', with the task-only PM constraint and no automatic fallback.

- [ ] **Step 5: Run command tests and documentation checks**

Run:

~~~text
npm test -- src/commands/model.test.ts src/commands/provider.test.ts src/commands/inspection.test.ts
git diff --check
~~~

Expected: command tests pass and 'git diff --check' has no output.

- [ ] **Step 6: Commit command and documentation changes**

~~~text
git add src/commands/definitions.ts src/commands/usage.ts src/commands/model.ts src/commands/model.test.ts README.md docs/architecture/provider-neutral-runtime.md
git commit -m "docs: expose OpenCode task provider"
~~~

### Task 7: Full verification and handoff

**Files:**
- Modify only files required by failing tests; do not weaken or delete the known baseline onboarding assertion.

- [ ] **Step 1: Run all tests**

Run: 'npm test'

Expected: all new OpenCode tests pass. Compare the result to the recorded baseline of 163/164 passing; the pre-existing runtime onboarding failure must either be fixed with a separate justified test change or remain explicitly reported.

- [ ] **Step 2: Run the production build**

Run: 'npm run build'

Expected: TypeScript exits with code 0.

- [ ] **Step 3: Run whitespace and status checks**

~~~text
git diff --check
git status --short --branch
git log -8 --oneline
~~~

Expected: no whitespace errors; only intended OpenCode changes and commits are present on 'codex/opencode-acp'.

- [ ] **Step 4: Run the final contract review**

Verify each approved requirement against the code: ACP-only CLI transport, provider session persistence, normalized events, Discord approval mapping, no auto-approval, task worktree cwd, no credential persistence, explicit model failure, task-only PM scope, runtime availability gating, docs, and no automatic replay.

- [ ] **Step 5: Commit any final verified fixes**

~~~text
git add package.json package-lock.json src README.md docs/architecture/provider-neutral-runtime.md
git commit -m "test: verify OpenCode ACP provider"
~~~

Report exact test/build results and the known baseline status; do not claim a fully green suite unless 'npm test' exits successfully with zero failures.

## Plan self-review

- Spec coverage: provider lifecycle is covered by Tasks 2–4; normalized events and approvals by Task 3; runtime/config/PM scope by Tasks 1 and 5; model/usage/command/docs by Task 6; security and verification by Tasks 2–4 and 7.
- Placeholder scan: no 'TBD', 'TODO', or unspecified implementation steps are used; the final verification commit stages only the dependency, source, and documentation paths named in this plan.
- Type consistency: 'AgentProviderId' includes 'opencode'; 'OpenCodeProviderOptions.createConnection' returns 'OpenCodeAcpConnection'; runtime passes 'models.opencode'; adapter functions use 'AgentEvent', 'ApprovalRequest', 'ApprovalDecision', and 'TaskResult' from 'src/agents/contracts.ts'.
- Scope check: PM support remains a stated non-goal and does not require a second implementation plan.

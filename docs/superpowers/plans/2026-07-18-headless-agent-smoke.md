# Headless Agent Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline Discord-independent live-provider smoke path for the primary agent.

**Architecture:** Extend the existing runtime with an opt-in headless primary-agent transport mode rather than creating a second runtime. Reuse the provider registry, primary model constructors, context assembler, delegating conversation service, activation registry, repositories, and shutdown path while suppressing Discord channel/onboarding/recovery behavior.

**Tech Stack:** TypeScript, Node.js 22, Vitest, SQLite via better-sqlite3, Discord.js types, Claude/Codex/OpenCode provider adapters.

## Global Constraints

- Normal Discord startup behavior must remain unchanged by default.
- The smoke command must not log in to Discord or fetch guilds/channels.
- The smoke command must use temporary durable state and remove it on exit.
- Real provider checks are opt-in and must not join the default CI smoke command.
- Task launching remains unavailable in headless mode.

---

### Task 1: Define headless runtime behavior

**Files:**
- Modify: `src/services/runtime.test.ts`
- Modify: `src/services/runtime.ts`

**Interfaces:**
- Consumes: `startRuntime(client, options)`, `activatePrimaryProvider(provider)` and `PrimaryConversationService.process(input)`.
- Produces: `RuntimeOptions.headlessPrimaryAgent`, `RuntimeOptions.primaryProvider`, and `RuntimeOptions.primaryModelFactory`.

- [x] **Step 1: Write the failing regression test**

Add a test that starts with fake Claude and Codex providers, selects Claude, sends a turn, activates Codex, sends another turn through the same conversation service, verifies provider-specific replies and four journal entries, and asserts no channel fetch.

- [x] **Step 2: Verify the test fails**

Run through pull-request CI and confirm failure before runtime implementation.

- [x] **Step 3: Implement minimal headless runtime behavior**

Add explicit options, skip guild/channel and recovery rendering, construct and activate the selected primary provider, preserve the shared delegator, and reject task launch.

- [ ] **Step 4: Run focused and full verification**

Run `npm test`, `npm run build`, `npm run check:docs`, and `git diff --check` through CI.

### Task 2: Add the live-provider smoke command

**Files:**
- Create: `src/smoke/agentRoundTrip.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `startRuntime()` headless options, `activatePrimaryProvider()`, provider availability, `PrimaryConversationService`, and `MessageRepository`.
- Produces: `npm run smoke:agent -- --provider <provider> [--switch-provider <provider>] [--prompt <text>]`.

- [x] **Step 1: Parse and validate provider arguments**

Accept `claude`, `codex`, or `opencode`; require an initial provider; reject identical switch providers.

- [x] **Step 2: Run an isolated round trip**

Create a temporary database/worktree directory, initialize only requested providers, send a prompt, verify a nonempty response and journal roles, then shut down and remove temporary files.

- [x] **Step 3: Support provider reconfiguration**

Check target availability, call the production activation boundary, send a second turn through the same conversation service, and verify four journal entries.

- [ ] **Step 4: Verify compilation and tests**

Use pull-request CI for `npm test` and `npm run build`.

### Task 3: Document operational usage

**Files:**
- Create: `docs/how-to/operations/verify-agent-plumbing-without-discord.md`
- Modify: `docs/how-to/README.md`

**Interfaces:**
- Produces: A Diátaxis how-to guide covering invocation, provider switching, scope, failure behavior, and remaining Discord-only checks.

- [x] **Step 1: Write the guide**

Document one-provider and switch-provider commands, the verification boundary, and failure behavior.

- [x] **Step 2: Link the guide**

Add it to the Operations section of the how-to index.

- [ ] **Step 3: Verify links**

Run `npm run check:docs` through CI.

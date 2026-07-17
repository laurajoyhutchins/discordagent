# Discord Task Control Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral message-to-task intake and durable Discord task control cards with inspect, cancel, and restart recovery behavior.

**Architecture:** Keep task state authoritative in the existing SQLite repositories and coordinator. Add a small optional `TaskControlSurface` coordinator port, a Discord implementation that upserts one message by task ID, and isolated command/interaction handlers that resolve projects and tasks through existing services.

**Tech Stack:** TypeScript 5.5, Node.js 22, discord.js 14, Vitest 4, SQLite through the existing repository layer.

## Global Constraints

- Do not import or reference Factory Floor types, identifiers, packages, or lifecycle vocabulary.
- Preserve immutable provider identity, worktree isolation, usage admission, and explicit continuation semantics.
- Control-message failures must never fail or roll back task execution.
- Sensitive task and provider content must pass through existing redaction boundaries.
- New behavior must be covered by failing tests before production code.

---

### Task 1: Message Context Task Intake

**Files:**
- Create: `src/commands/turnIntoTask.test.ts`
- Create: `src/commands/turnIntoTask.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/handlers/interactionHandler.ts`

**Interfaces:**
- Consumes: `TaskCoordinator.startFromMessage`, `getProjectByChannel`, existing project provider/model fields.
- Produces: `handleTurnIntoTask(interaction, dependencies?)` and a guild message context command named `Turn into task`.

- [x] Write tests proving successful routing, authorization rejection, unregistered-channel rejection, empty-content rejection, and existing-thread rejection.
- [x] Run `npx vitest run src/commands/turnIntoTask.test.ts` and verify the suite fails because the handler does not exist.
- [x] Implement the minimum command handler and register `ContextMenuCommandBuilder` with `ApplicationCommandType.Message`.
- [x] Route message context interactions before chat-input handling.
- [x] Run `npx vitest run src/commands/turnIntoTask.test.ts src/handlers/messageHandler.test.ts` and verify both suites pass.
- [x] Run `npm run build` and fix only type errors introduced by this task.

### Task 2: Generic Task Control Cards

**Files:**
- Create: `src/discord/taskControl.test.ts`
- Create: `src/discord/taskControl.ts`
- Modify: `src/coordinator/taskCoordinator.ts`
- Modify: `src/coordinator/taskCoordinator.test.ts`
- Modify: `src/services/runtime.ts`

**Interfaces:**
- Produces: `TaskControlSurface.update(thread, task, result?)`, `DiscordTaskControlSurface`, `buildTaskControlPayload`, `parseTaskControlCustomId`.
- Consumes: `TaskRecord`, `TaskResult`, Discord thread message fetch/send/edit APIs.

- [x] Write failing tests for custom-ID parsing, active/terminal payloads, existing-card edit, missing-card creation, and coordinator lifecycle updates.
- [x] Run `npx vitest run src/discord/taskControl.test.ts src/coordinator/taskCoordinator.test.ts` and verify failures are caused by missing control-surface behavior.
- [x] Implement the Discord payload builder and upsert algorithm.
- [x] Add the optional coordinator dependency and invoke it through a redacted non-fatal helper after durable status transitions.
- [x] Wire the Discord implementation in `startRuntime`.
- [x] Run the focused tests and `npm run build` until green.

### Task 3: Inspect, Cancel, and Recovery Refresh

**Files:**
- Create: `src/discord/taskControlHandler.test.ts`
- Create: `src/discord/taskControlHandler.ts`
- Modify: `src/handlers/interactionHandler.ts`
- Modify: `src/services/runtime.ts`
- Modify: `README.md`
- Modify: `docs/architecture/provider-neutral-runtime.md`
- Modify: `src/test/providerNeutralArchitecture.test.ts`

**Interfaces:**
- Consumes: `getTaskRepository`, `getTaskCoordinator`, `DiscordTaskControlSurface.update`.
- Produces: `handleTaskControlButton(interaction, dependencies?)`.

- [x] Write failing tests for inspect, active cancellation, terminal cancellation rejection, unauthorized use, and wrong-thread rejection.
- [x] Implement the button handler and route task-control buttons before loop controls.
- [x] Refresh task controls after successful cancellation and restart recovery.
- [x] Document the context command, control cards, permission requirements, and explicit continuation behavior.
- [x] Extend the provider-neutral architecture regression test to reject Factory Floor imports from the new modules.
- [x] Run focused non-SQLite tests, `npm run build`, and `git diff --check`.
- [x] Publish the feature branch and open a draft pull request; use GitHub Actions for the full native-dependency test suite.

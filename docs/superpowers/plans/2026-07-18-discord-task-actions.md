# Discord Task Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message-to-task intake and provider-neutral Inspect/Cancel controls to the existing persisted Discord task card.

**Architecture:** Keep SQLite and `TaskCoordinator` authoritative. Extend the current `taskControlCard` payload with stable action-only component IDs, resolve button actions from the current task thread, and route message context commands through the existing coordinator so settings stay centralized.

**Tech Stack:** TypeScript 5.5, Node.js 22, discord.js 14, Vitest 4, SQLite.

## Global Constraints

- Do not add a second task-control projection or message-discovery algorithm.
- Do not expose task IDs or provider session IDs in Discord component IDs or user-visible inspection output.
- Resolve provider/model/reasoning settings through the existing coordinator and settings service.
- Keep every response authorization-checked and private where appropriate.
- Preserve buttons in embed and plain-text card modes.
- Use tests-first development and GitHub Actions as the authoritative integration check.

---

### Task 1: Failing behavior tests

**Files:**
- Create: `src/commands/turnIntoTask.test.ts`
- Create: `src/discord/taskControlHandler.test.ts`
- Modify: `src/discord/taskControlCard.test.ts`
- Modify: `src/handlers/interactionHandler.test.ts`

**Interfaces:**
- Consumes: existing `commands`, `TaskCoordinator.startFromMessage`, `TaskRepository.findByThreadId/getResult/getWorktree`, and `TaskCoordinator.cancelByThread`.
- Produces: expected APIs `handleTurnIntoTask`, `taskControlCustomId`, `parseTaskControlCustomId`, `handleTaskControlButton`, and `routeTaskControlComponents`.

- [ ] Add tests for message context command registration and all intake guards.
- [ ] Add tests proving active cards expose Inspect/Cancel, terminal cards expose Inspect only, and plain-text cards retain components.
- [ ] Add tests for inspect, cancel, unauthorized, stale-thread, and terminal-cancel behavior.
- [ ] Add a routing test proving task-control buttons are consumed before generic button handling.
- [ ] Push the tests-only commit and verify CI fails because the new APIs and behavior do not yet exist.

### Task 2: Minimal implementation

**Files:**
- Create: `src/commands/turnIntoTask.ts`
- Create: `src/discord/taskControlHandler.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/discord/taskControlCard.ts`
- Modify: `src/discord/taskRenderer.ts`
- Modify: `src/handlers/interactionHandler.ts`

**Interfaces:**
- `taskControlCustomId(action: 'inspect' | 'cancel'): string`
- `parseTaskControlCustomId(customId: string): 'inspect' | 'cancel' | undefined`
- `handleTaskControlButton(interaction, dependencies?): Promise<boolean>`
- `handleTurnIntoTask(interaction, dependencies?): Promise<void>`
- `routeTaskControlComponents(interaction, handler?): Promise<boolean>`

- [ ] Register the `Turn into task` message command.
- [ ] Implement intake validation and coordinator delegation without duplicating settings resolution.
- [ ] Add stable task action buttons to the existing card payload.
- [ ] Preserve components through embed-to-text send and edit fallbacks.
- [ ] Implement repository-backed private inspection and coordinator-backed cancellation.
- [ ] Route task-control buttons in `interactionHandler`.
- [ ] Push and run the focused tests, full suite, TypeScript build, and whitespace check in CI.

### Task 3: Documentation and delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/guides/using-task-control-cards.md`
- Modify: `docs/reference/commands.md`

- [ ] Document message-to-task intake and task card controls.
- [ ] Verify the final PR contains no superseded control-surface implementation.
- [ ] Review the final diff and CI results.
- [ ] Squash merge the successor PR when green.
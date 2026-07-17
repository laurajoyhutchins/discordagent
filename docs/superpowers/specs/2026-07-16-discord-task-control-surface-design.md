# Discord Task Control Surface Design

**Date:** 2026-07-16
**Status:** Implemented
**Target:** `laurajoyhutchins/discordagent`

## Purpose

Add the highest-value Discord-native controls that are still missing from the provider-neutral runtime without introducing Factory Floor concepts or dependencies.

The extension provides:

- a message context command named **Turn into task** for starting work from an existing project-channel message;
- one persistent task control card per Discord task thread;
- generic **Inspect** and **Cancel** controls resolved through the existing task repository and coordinator;
- recovery-time control-card refresh after a bot restart.

Existing provider approvals, user questions, select menus, polls, ephemeral responses, task threads, and primary-agent delegation remain unchanged.

## Boundaries

The Discord layer depends only on existing provider-neutral concepts:

- `Project`;
- `TaskRecord` and `TaskStatus`;
- `TaskResult`;
- `TaskCoordinator`;
- `TaskRepository`.

It must not import Factory Floor packages, identifiers, event schemas, or lifecycle terms. A future Factory Floor adapter may create ordinary Discord Agent tasks or expose links, but the Discord control surface will not know which backend produced the task.

## Message-to-task intake

Register a guild message context command named **Turn into task**.

When invoked:

1. authorize the invoking member using the existing role policy;
2. require the selected message to be in a registered project `#agent` channel;
3. require non-empty message text;
4. reject messages that already own a Discord thread, avoiding duplicate task threads;
5. acknowledge privately;
6. call `TaskCoordinator.startFromMessage` with the selected message, its exact text, the project name, and the project default provider/model;
7. edit the private acknowledgement with a link to the created task thread.

No worktree or provider call occurs before the coordinator's existing availability and usage-admission checks.

## Task control card

A new `TaskControlSurface` interface separates coordinator lifecycle events from Discord rendering:

```ts
export interface TaskControlSurface {
  update(thread: AnyThreadChannel, task: TaskRecord, result?: TaskResult): Promise<void>;
}
```

The Discord implementation searches recent bot messages in the thread for a component custom ID containing the task ID. It edits the existing card when found and sends one otherwise. This avoids a schema migration while allowing restart recovery to refresh the durable Discord message.

The card displays:

- objective;
- project;
- provider;
- current generic task state;
- branch when available;
- terminal summary and verification when available.

Active cards expose **Inspect** and **Cancel**. Terminal cards expose **Inspect** and explain that a new thread message explicitly continues the preserved provider session and worktree.

## Interaction handling

Task-control custom IDs use this stable form:

```text
task-control:<inspect|cancel>:<task-id>
```

The handler:

- authorizes the invoking member;
- parses and validates the custom ID;
- loads the task from `TaskRepository`;
- requires the interaction to occur in the task's own thread;
- returns current details ephemerally for **Inspect**;
- delegates **Cancel** to `TaskCoordinator.cancelByThread`;
- refreshes the control card after cancellation.

Stale cards are safe: terminal or missing tasks produce a private explanatory response rather than replaying work or mutating another task.

## Coordinator integration

`TaskControlSurface` is an optional coordinator dependency so non-Discord tests and alternate frontends can use a no-op surface.

The coordinator refreshes the card after durable transitions to:

- `starting`;
- `running`;
- `waiting_for_user`;
- `running` after a decision;
- each terminal state.

Control-card failures are non-fatal and redacted in logs. They never change task state or provider execution.

## Recovery

After startup recovery marks a task `interrupted`, the existing recovery notification also refreshes or creates its control card. No provider turn is replayed. The card points the operator toward an explicit thread reply to resume.

## Testing

Unit tests cover:

- message context command registration and routing;
- project-channel, empty-message, existing-thread, and authorization guards;
- control custom-ID parsing;
- active and terminal card rendering;
- card update versus creation;
- inspect and cancel authorization/thread ownership;
- coordinator lifecycle calls to the optional control surface;
- provider-neutral architecture boundaries.

GitHub Actions remains the authoritative integration check for the merge checkout and native SQLite dependency.

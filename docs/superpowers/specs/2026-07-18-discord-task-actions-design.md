# Discord Task Actions Design

**Date:** 2026-07-18
**Status:** Implemented
**Target:** `laurajoyhutchins/discordagent`

## Purpose

Recover the useful Discord-native behavior from superseded PR #12 without restoring its competing task-control projection.

The feature adds:

- a message context command named **Turn into task** for existing messages in registered project `#agent` channels;
- provider-neutral **Inspect** and **Cancel** buttons on the existing durable task control card;
- private, authorization-checked responses for task actions.

## Architecture

The existing SQLite task repository and `TaskCoordinator` remain authoritative. `DiscordTaskRenderer` continues to own the single persisted task control card and its restart recovery behavior.

Task buttons use stable custom IDs that contain only the action:

```text
task-control:inspect
task-control:cancel
```

The button handler resolves the task from the current Discord thread with `TaskRepository.findByThreadId`. This avoids exposing task IDs in component payloads and makes cross-thread use fail closed.

## Message-to-task intake

The guild message context command:

1. authorizes the invoking member with the existing role policy;
2. requires the selected message to be in a registered project `#agent` channel;
3. requires non-empty message text;
4. rejects messages that already own a Discord thread;
5. privately acknowledges the interaction;
6. delegates to `TaskCoordinator.startFromMessage` using the project name and exact message text;
7. returns a link to the created task thread.

Provider, model, reasoning, MCP, timeout, and other settings remain resolved by the coordinator and current settings service rather than being copied into the command handler.

## Task controls

`renderTaskControlCard` adds:

- **Inspect** for every task state;
- **Cancel** only for nonterminal task states.

The controls are retained when the card renders in embed or permission-driven plain-text mode.

**Inspect** reads the current task, result, and worktree from the repository and returns a redacted private summary. **Cancel** delegates to `TaskCoordinator.cancelByThread`; the existing active renderer updates the persisted card through the normal coordinator lifecycle.

## Error and security behavior

- Every action rechecks authorization.
- A button outside a known task thread returns a private stale-control message.
- Terminal cancellation returns a private explanatory response and performs no mutation.
- Error text passes through existing redaction helpers.
- Task state is never inferred from Discord message content.

## Testing

Tests cover command registration, intake guards, coordinator delegation, active and terminal button rendering, plain-text card components, inspect behavior, cancellation behavior, authorization, stale controls, and interaction routing.

GitHub Actions is the authoritative full-suite and TypeScript build verification environment.

# Commands

## Slash commands

| Command | Scope | Description |
|---|---|---|
| `/add-project` | Any guild channel | Register a project directory and create its Discord channels |
| `/remove-project` | Project channel | Soft-archive a project and remove its Discord channels |
| `/list-projects` | Any guild channel | Show registered projects |
| `/provider` | Project channel or `#agent-chat` | View or set the default Claude, Codex, or OpenCode provider |
| `/model` | Project channel or `#agent-chat` | View or set the active provider's model; Codex also supports reasoning depth |
| `/settings` | `#agent-chat` only | View and edit global agent and PM settings |
| `/project-settings` | Project channel | View and edit project-scoped settings |
| `/capabilities` | Guild channel | Show effective Discord capabilities and fallbacks |
| `/agents` | Guild channel | Show active task threads, providers, and status |
| `/usage` | Guild channel | Show provider usage posture and reservations |
| `/cancel` | Task thread | Cancel the durable task while preserving its worktree |
| `/close` | Completed task thread | Remove a clean completed task worktree |
| `/loop` | Project channel | Start periodic task execution |
| `/stop-loop` | Project channel or loop thread | Stop periodic task execution |
| `/codex-auth` | `#agent-chat` only | Check, establish, or revoke Codex authentication |

## Text commands

These work when typed as messages in a project channel or task thread where noted.

| Command | Scope | Description |
|---|---|---|
| `/provider claude\|codex\|opencode` | Project channel | Set the project's default provider |
| `/provider claude\|codex\|opencode` | Task thread | Request a confirmed sibling handoff to a fresh provider session |
| `/model [name]` | Project channel | View or set the project's model for its current provider |
| `/model <name> <prompt>` | Project channel or task thread | Use a one-turn model override without changing stored settings |
| `/loop [interval] <prompt>` | Project channel | Start periodic task execution |
| `/stop-loop` | Project channel or loop thread | Stop periodic task execution |
| `/status` | Project channel or loop thread | Show loop status |

## Command details

### `/settings`

Opens an owner-only ephemeral panel with controls for:

- default provider;
- Claude, Codex, and OpenCode model overrides;
- PM model;
- Claude timeout;
- usage reserve;
- provider-supported reasoning effort.

Changing the default provider or PM model reconfigures the PM service transactionally. A failed activation rolls back the persisted setting.

### `/project-settings`

Opens an authorized ephemeral panel for:

- default provider;
- Claude, Codex, and OpenCode model overrides;
- Codex reasoning effort;
- base branch;
- Claude MCP profile;
- channel-managed Roborev state.

Existing task threads keep their immutable provider and task-settings snapshot.

### `/capabilities`

Reports effective Discord permission state, Gateway intents, and fallback behavior for the current channel. The report uses plain text so it remains available without `Embed Links`.

### `/provider`

In a project channel, this changes the provider used by new tasks. In `#agent-chat`, the configured owner changes the global PM/default provider. In a task thread, a provider change is never in-place: after confirmation, Discord Agent creates a sibling task with a new provider session and worktree.

### `/model`

In a project channel, this changes the model for the project's current provider. In `#agent-chat`, it changes PM/global settings. `thinking` is supported only for Codex; Claude and OpenCode retain provider-managed reasoning behavior.

## Message-based task creation

Any non-command message in a project's `#agent` channel creates a new task. Replies in a task thread continue that task. A one-shot model override uses the `/model` prefix:

```text
/model gpt-5-codex Implement the authentication flow
```

This uses `gpt-5-codex` for that turn only without changing the stored project or global model.

# Commands

## Application commands

| Command | Type | Scope | Description |
|---|---|---|---|
| **Turn into task** | Message context action | Registered project `#agent` channel | Create a durable task from the selected message text |
| `/add-project` | Slash command | Any guild channel | Register a project directory and create its Discord channels |
| `/remove-project` | Slash command | Project channel | Soft-archive a project and remove its Discord channels |
| `/list-projects` | Slash command | Any guild channel | Show registered projects |
| `/provider` | Slash command | Project channel or `#agent-chat` | View or set the default Claude, Codex, or OpenCode provider |
| `/model` | Slash command | Project channel or `#agent-chat` | View or set the active provider's model; Codex also supports reasoning depth |
| `/settings` | Slash command | `#agent-chat` only | View and edit global agent and PM settings |
| `/project-settings` | Slash command | Project channel | View and edit project-scoped settings |
| `/capabilities` | Slash command | Guild channel | Show effective Discord capabilities and fallbacks |
| `/agents` | Slash command | Guild channel | Show active task threads, providers, and status |
| `/usage` | Slash command | Guild channel | Show provider usage posture and reservations |
| `/cancel` | Slash command | Task thread | Cancel the durable task while preserving its worktree |
| `/loop` | Slash command | Project channel | Start periodic task execution |
| `/stop-loop` | Slash command | Project channel or loop thread | Stop periodic task execution |
| `/codex-auth` | Slash command | `#agent-chat` only | Check, establish, or revoke Codex authentication |

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

### `Turn into task`

Open a message's context menu and choose **Apps → Turn into task**. The selected message must:

- be in a registered project `#agent` channel;
- contain text;
- not already own a Discord thread.

The command delegates to the normal task coordinator. Provider, model, reasoning, timeout, MCP, usage admission, worktree isolation, and task-card behavior therefore match ordinary project-channel task creation.

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

Any non-command message in a project's `#agent` channel creates a new task. You can also use **Turn into task** on an existing message in that channel. Replies in a task thread continue that task. A one-shot model override uses the `/model` prefix:

```text
/model gpt-5-codex Implement the authentication flow
```

This uses `gpt-5-codex` for that turn only without changing the stored project or global model.
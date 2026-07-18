# Commands

## Slash commands

| Command | Scope | Description |
|---|---|---|
| `/add-project` | Any channel | Register a new project directory and create Discord channels |
| `/remove-project` | Project channel | Soft-archive a project |
| `/list-projects` | Any channel | Show all registered projects |
| `/provider` | Project channel or `#agent-chat` | View or set the default provider |
| `/model` | Project channel or `#agent-chat` | View or set the model and reasoning depth |
| `/settings` | `#agent-chat` only | View and edit global agent and PM settings |
| `/project-settings` | Project channel | View and edit project-scoped settings |
| `/capabilities` | Any channel | Show effective Discord capabilities and fallbacks |
| `/agents` | Any channel | Show active task threads, providers, and status |
| `/usage` | Any channel | Show provider rate limit usage and task stats |
| `/cancel` | Task thread | Cancel the running task |
| `/close` | Task thread | Remove the completed task's worktree |
| `/loop` | Project channel | Start periodic task execution |
| `/stop-loop` | Project channel or loop thread | Stop periodic task execution |
| `/codex-auth` | `#agent-chat` only | Check, establish, or revoke Codex authentication |
| `/help` | Any channel | Show available commands |

## Text commands

These work when typed as a message in a project channel.

| Command | Description |
|---|---|
| `/provider claude\|codex` | Set the project's default provider |
| `/model [name]` | View or set the project's model for the current provider |
| `/loop` | Start periodic task execution |
| `/stop-loop` | Stop periodic task execution |
| `/status` | Show project and task status |

## Command details

### `/settings`

Opens an ephemeral panel with select menus and buttons for:

- Default provider
- Claude model override
- Codex model override
- Primary agent model
- Claude timeout (5–3600 seconds)
- Usage reserve (0–50%)
- Per-provider reasoning effort

Provider changes activate the PM agent immediately. Model and timeout changes persist silently.

### `/project-settings`

Opens an ephemeral panel for:

- Default provider
- Claude / Codex model override
- Per-provider reasoning effort (Codex only)
- Base branch
- MCP profile
- Roborev enable/disable

### `/capabilities`

Reports effective Discord permission state, Gateway intents, and fallback behavior for the current channel. Uses plain text so it works without `Embed Links`.

### `/provider`

When used in a project channel, sets the project's default provider. When used in `#agent-chat` by the configured owner, sets the global default.

### `/model`

In a project channel, sets project-level model and thinking depth. In `#agent-chat`, sets global defaults for the PM agent.

## Message-based task creation

Any non-command message in a project's `#agent` channel creates a new task. Replies in a task thread continue that task. A one-shot model override can be prefixed:

```
gpt-5-codex: Implement the authentication flow
```

This uses `gpt-5-codex` for that turn only without changing the stored settings.

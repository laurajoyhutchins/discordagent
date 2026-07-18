# Managing Settings

Settings are organized by scope. Global settings apply to all projects; project settings apply to one project; task settings are snapshotted at task creation.

## Global settings

Open the global settings panel in `#agent-chat`:

```
/settings
```

### Available settings

| Setting | Description | Persists |
|---|---|---|
| Default provider | Provider for new projects | Immediately |
| Claude model | Override for Claude tasks | Immediately |
| Codex model | Override for Codex tasks | Immediately |
| Primary agent model | Model used by the PM chat | Requires PM re-activation |
| Claude timeout | Maximum task execution time (5–3600s) | Immediately |
| Usage reserve | Capacity reserved for PM operations (0–50%) | Next reservation only |
| Reasoning efforts | Default reasoning depth per provider | Immediately |

### Quick shortcuts

```
/provider codex          # Set global provider
/model custom:gpt-5.6-luna thinking:xhigh   # Set global model + reasoning
```

## Project settings

Open the project settings panel in any project channel:

```
/project-settings
```

### Available settings

| Setting | Description |
|---|---|
| Default provider | Provider for new tasks in this project |
| Claude model | Project-level model override |
| Codex model | Project-level model override |
| Reasoning effort | Codex reasoning depth |
| Base branch | Git branch used as worktree base |
| MCP profile | Named MCP server profile |
| Roborev | Enable/disable automated code review |

### Quick shortcuts

```
/provider claude         # Set project provider
/model sonnet             # Set project model
```

## Task settings

When a task is created, the effective settings are resolved from:

1. Host defaults (environment variables)
2. Global settings
3. Project settings
4. One-message override

The resolved settings are snapshotted and stored immutably on the task record. Changes to global or project settings after task creation do not affect running or completed tasks.

### One-message overrides

Prefix a task message with a model name to override the model for that turn only:

```
gpt-5-codex: Implement input validation
```

This uses `gpt-5-codex` for that single provider turn without modifying the stored settings.

## Settings precedence

See [Settings Precedence](/docs/explanation/settings-precedence.md) for the complete precedence order and provider-specific validation rules.

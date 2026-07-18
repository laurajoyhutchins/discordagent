# Commands

## Slash commands

| Command | Discord contexts | Authorization | Side effects |
|---|---|---|---|
| `/add-project` | Any guild channel | `AUTHORIZED_ROLE_IDS` | Creates Discord category, #agent channel, optional #roborev channel; persists project in SQLite |
| `/list-projects` | Any guild channel | `AUTHORIZED_ROLE_IDS` | None (read-only) |
| `/remove-project` | Any guild channel | `AUTHORIZED_ROLE_IDS` | Soft-archives project; deletes Discord channels; preserves task records |
| `/provider` | Any guild channel, task thread | `AUTHORIZED_ROLE_IDS`; task-thread handoff requires confirmation | Changes default provider; in task threads creates sibling handoff |
| `/model` | Any guild channel, task thread | `AUTHORIZED_ROLE_IDS` | Changes stored model/reasoning setting; does not affect running tasks |
| `/settings` | `#agent-chat` only | Owner only (`AUTHORIZED_USER_ID`) | Persists global settings; provider/model changes reactivate PM |
| `/project-settings` | Project channel | `AUTHORIZED_ROLE_IDS` | Persists project settings |
| `/capabilities` | Any guild channel | `AUTHORIZED_ROLE_IDS` | None (read-only Discord permissions report) |
| `/agents` | Any guild channel | `AUTHORIZED_ROLE_IDS` | None (read-only status report) |
| `/usage` | Any guild channel | `AUTHORIZED_ROLE_IDS` | None (read-only usage report) |
| `/cancel` | Task thread | `AUTHORIZED_ROLE_IDS` | Cancels the task; preserves worktree; persists terminal status |
| `/loop` | Project channel | `AUTHORIZED_ROLE_IDS` | Creates recurring task in one thread/session/worktree |
| `/stop-loop` | Project channel, loop thread | `AUTHORIZED_ROLE_IDS` | Stops the running loop |
| `/codex-auth` | `#agent-chat` only | Owner only | Manages in-memory Codex authentication state |

### `/add-project`

**Parameters:**
- `name` (string, required) — project name, used for Discord category
- `path` (string, required) — absolute filesystem path to the Git repository
- `roborev` (boolean, optional) — enable Roborev integration; auto-detected if omitted

**Failure behavior:** Rolls back Discord channel creation if path validation fails. Does not create incomplete channel sets.

### `/provider`

**Parameters:**
- `provider` (choice: Claude, Codex, OpenCode, optional) — if omitted, displays current provider

**Context-dependent behavior:**
- In `#agent-chat`: changes the global/default provider for the PM and new projects
- In a project channel: changes the project's default provider for new tasks
- In a task thread: creates a confirmed sibling handoff to a new provider session

### `/model`

**Parameters:**
- `model` (string, optional) — provider-scoped model alias or exact ID
- `custom` (string, optional) — set a custom model name directly
- `thinking` (choice, optional) — Codex reasoning effort: `__default__`, `none`, `low`, `medium`, `high`, `xhigh`, `max`

Existing task threads keep their immutable task-settings snapshot.

### `/cancel`

No parameters. Cancels the task associated with the current thread. The worktree is preserved. The task status transitions to `cancelled`.

### `/loop`

**Parameters:**
- `prompt` (string, required) — the prompt to run repeatedly
- `interval` (string, optional) — interval between runs (e.g. `5m`, `1h`, `30s`); default `10m`

### `/codex-auth`

**Subcommands:**
- `status` — check Codex authentication state
- `login` — start private device-code sign-in flow
- `logout` — log out Codex after confirmation

## Text commands

These work when typed as messages in a project channel or task thread.

| Command | Context | Behavior |
|---|---|---|
| `/provider claude\|codex\|opencode` | Project channel | Set the project's default provider |
| `/provider claude\|codex\|opencode` | Task thread | Request a sibling handoff |
| `/model [name]` | Project channel | View or set the project's model |
| `/model <name> <prompt>` | Project channel or task thread | One-turn model override without changing stored settings |
| `/loop [interval] <prompt>` | Project channel | Start periodic task execution |
| `/stop-loop` | Project channel or loop thread | Stop periodic task execution |
| `/status` | Project channel or loop thread | Show loop status |

## Message-based task creation

Any non-command message in a project's `#agent` channel creates a new task. Replies in a task thread continue that task. A one-shot model override uses the `/model` prefix:

```text
/model gpt-5-codex Implement the authentication flow
```

This uses `gpt-5-codex` for that turn only without changing stored settings.

## Authorization summary

| Level | Check | Scope |
|---|---|---|
| Global commands (`/settings`, `/codex-auth`) | `AUTHORIZED_USER_ID` exact match | `#agent-chat` only |
| Project commands | `AUTHORIZED_ROLE_IDS` membership | Any guild channel |
| Task operations (`/cancel`, continuation) | Channel access + role check | Task thread only |
| Provider onboarding buttons | Owner + correct channel + current message | `#agent-chat` only |

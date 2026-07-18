# Commands

Discord Agent registers slash commands and a Discord message context command. Ordinary natural-language messages remain the primary interface for starting and continuing tasks.

## Message context command

| Command | Discord context | Authorization | Side effects |
|---|---|---|---|
| **Turn into task** | Existing text message in a registered project `#agent` channel | `AUTHORIZED_ROLE_IDS` | Creates a durable task thread, isolated branch and worktree, and provider session through the normal task coordinator |

Open a message's context menu and choose **Apps → Turn into task**. The selected message must contain text, belong to a registered project `#agent` channel, and not already own a thread. The command uses the project's normal provider and settings resolution; it does not implement a separate task path.

## Slash commands

| Command | Valid Discord context | Authorization | Side effects |
|---|---|---|---|
| `/help` | Any guild channel | `AUTHORIZED_ROLE_IDS` | Read-only contextual guidance for the primary channel, project channel, task thread, or general workspace |
| `/add-project` | Guild channel | `AUTHORIZED_ROLE_IDS` | Creates a project category and `#agent` channel, optionally creates `#roborev`, and persists the project |
| `/list-projects` | Guild channel | `AUTHORIZED_ROLE_IDS` | Read-only project listing |
| `/remove-project` | Guild channel | `AUTHORIZED_ROLE_IDS` | Archives the project and deletes its Discord category and channels; preserves historical records and worktrees |
| `/provider` | `#agent-chat`, project channel, or task thread | Owner in `#agent-chat`; otherwise `AUTHORIZED_ROLE_IDS` | Changes a global/project default or proposes a confirmed sibling handoff from a task thread |
| `/model` | `#agent-chat`, project channel, or supported task context | Owner in `#agent-chat`; otherwise `AUTHORIZED_ROLE_IDS` | Changes provider-scoped defaults or supplies a one-turn override; does not convert an existing provider session |
| `/settings` | `#agent-chat` | `AUTHORIZED_USER_ID` | Opens owner-only global settings controls and persists supported global settings |
| `/project-settings` | Registered project channel | `AUTHORIZED_ROLE_IDS` | Opens project-scoped settings controls and persists supported project settings |
| `/capabilities` | Guild channel | `AUTHORIZED_ROLE_IDS` | Read-only report of effective Discord capabilities and fallbacks |
| `/agents` | Guild channel | `AUTHORIZED_ROLE_IDS` | Read-only active-task and reservation report |
| `/usage` | Guild channel | `AUTHORIZED_ROLE_IDS` | Read-only provider-window and admission report |
| `/cancel` | Task thread | `AUTHORIZED_ROLE_IDS` | Cancels the task while preserving its record and worktree |
| `/loop` | Registered project channel | `AUTHORIZED_ROLE_IDS` | Starts recurring turns in one durable thread, task, session, and worktree |
| `/stop-loop` | Project channel or loop thread | `AUTHORIZED_ROLE_IDS` | Stops the associated recurring loop |
| `/codex-auth` | `#agent-chat` | `AUTHORIZED_USER_ID` | Reads or changes host-local Codex authentication state through owner-only controls |
| `/roborev` | Guild channel | `AUTHORIZED_ROLE_IDS` | Enables or disables RoboRev review delivery for a named project and reconciles the review-source lifecycle |

## Slash-command details

### `/help`

No parameters. Discord Agent detects the current context and returns a private guidance card:

- in `#agent-chat`, it explains natural PM conversation and global controls;
- in a project channel, it explains how ordinary messages create isolated durable tasks;
- in a task thread, it explains continuation, inspection, cancellation, one-turn model overrides, and sibling provider handoffs;
- elsewhere, it points to project discovery and registration commands.

The command is read-only and does not inspect or expose provider-session identifiers.

### `/add-project`

| Parameter | Required | Description |
|---|---:|---|
| `name` | Yes | Project name; normalized for the Discord category and durable project key |
| `path` | Yes | Literal filesystem path to the repository on the bot host |
| `roborev` | No | Enable or disable RoboRev explicitly; when omitted, Discord Agent detects the CLI and repository configuration |

The path must exist and resolve on the bot host. Discord does not expand `~`, shell variables, or command substitutions, so use a literal path. When `PROJECTS_BASE_DIR` is configured, the resolved project path must be beneath it.

Provider availability, path validation, and duplicate-name validation occur before channel creation. If later persistence fails after channels are created, Discord Agent attempts compensating channel cleanup rather than leaving a partial project installation.

When RoboRev is enabled, the project receives a `#roborev` channel and the review-source lifecycle is notified after the project is persisted.

### `/remove-project`

| Parameter | Required | Description |
|---|---:|---|
| `name` | Yes | Registered project name |

The project is soft-archived. Its Discord category and channels are deleted. Historical SQLite records and task worktrees are preserved. Review-source configuration is reconciled after removal.

### `/provider`

| Parameter | Required | Description |
|---|---:|---|
| `provider` | No | `claude`, `codex`, or `opencode`; omit to inspect the current setting |

- In `#agent-chat`, changes the global/default provider used by the PM-style primary agent and inherited by newly registered projects.
- In a project channel, changes the default provider for future project tasks.
- In a task thread, proposes a confirmed sibling handoff. The existing task's provider and session remain unchanged.

Provider selection succeeds only after an authoritative availability check.

### `/model`

| Parameter | Required | Description |
|---|---:|---|
| `model` | No | Provider-scoped model alias or exact model ID |
| `custom` | No | Exact custom model value when the static command schema cannot enumerate it |
| `thinking` | No | Codex reasoning effort: `__default__`, `none`, `low`, `medium`, `high`, `xhigh`, or `max` |

Stored settings affect the relevant global or project scope. A prompt-prefixed one-turn override affects only that provider turn. Existing tasks retain immutable provider identity and durable session context.

### `/cancel`

No parameters. The command resolves the durable task from the current thread, asks the provider to cancel the active turn, persists the terminal state, and preserves the worktree.

### `/loop`

| Parameter | Required | Description |
|---|---:|---|
| `prompt` | Yes | Prompt to run repeatedly |
| `interval` | No | Delay between iterations, such as `5m`, `1h`, or `30s`; default `10m` |

Iterations do not overlap. The loop reuses one durable task, thread, provider session, branch, and worktree.

### `/codex-auth`

- `status` — read the current Codex account/authentication state;
- `login` — begin the owner-only host-local sign-in flow;
- `logout` — revoke Codex authentication after confirmation.

Discord Agent never posts the provider verification URL or one-time code to Discord and never stores those values in SQLite.

### `/roborev`

| Parameter | Required | Description |
|---|---:|---|
| `project` | Yes | Registered project name |
| `enable` | Yes | `true` to create and persist a review channel; `false` to remove it |

Enabling first verifies that the configured RoboRev CLI is available and that the repository has RoboRev setup such as `.roborev`, `.roborev.json`, or the expected Git hook. It then creates `#roborev`, persists its channel ID, and notifies the in-process review source to reconcile.

Disabling deletes the project's review channel, clears the persisted channel ID, and notifies the review source. RoboRev is a review integration, not an agent provider; `/provider` does not select it.

## Text commands

Text commands are message prefixes interpreted in project channels or task threads where noted.

| Command | Context | Behavior |
|---|---|---|
| `/provider claude\|codex\|opencode` | Project channel | Set the project's default provider |
| `/provider claude\|codex\|opencode` | Task thread | Propose a sibling handoff |
| `/model [name]` | Project channel | View or set the project's provider-scoped model |
| `/model <name> <prompt>` | Project channel or task thread | Use a model for one turn without changing the stored setting |
| `/loop [interval] <prompt>` | Project channel | Start recurring task execution |
| `/stop-loop` | Project channel or loop thread | Stop recurring execution |
| `/status` | Project channel or loop thread | Show loop status |

## Natural-language task behavior

- A non-command message in a registered project's `#agent` channel creates a new durable task.
- **Turn into task** creates the same kind of task from an existing project-channel message.
- A reply in a task thread continues that task using its immutable provider and persisted provider session.
- A provider change from a task thread creates a confirmed sibling handoff rather than mutating the existing task.

Example one-turn model override:

```text
/model gpt-5-codex Implement the authentication flow
```

## Authorization summary

| Level | Check | Scope |
|---|---|---|
| Owner controls | Exact `AUTHORIZED_USER_ID` match | `#agent-chat`, `/settings`, and `/codex-auth` |
| Project and task controls | Membership in `AUTHORIZED_ROLE_IDS` | Registered guild channels and task threads |
| Task components | Role check plus current thread/request validation | Task control cards, approvals, and questions |
| Provider onboarding | Owner, expected channel, and current component validation | `#agent-chat` |

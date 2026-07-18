# Settings Precedence

Agent settings flow through four levels, each overriding the one below it. Immutable task snapshots ensure consistency across provider turns.

## Precedence order

| Priority | Level | Source | Scope |
|---|---|---|---|
| 1 (highest) | Turn override | `/model` one-shot prefix in message, `/continue` options | One provider turn |
| 2 | Task snapshot | Persisted at task creation | Entire task lifetime |
| 3 | Project settings | `/project-settings`, `/model`, `/provider` in project | One project |
| 4 | Global settings | `/settings` in `#agent-chat` | All projects |
| 5 (lowest) | Host defaults | Environment variables, config file | Global fallback |

## How settings are resolved

When a task starts, the coordinator calls `SettingsService.resolveTaskSettings()` which merges:

1. Host defaults from configuration
2. Global settings from the `runtime_settings` table
3. Project settings from the `projects` table
4. Any one-message override from the user's message

The resolved settings are persisted as a JSON snapshot on the task record. This snapshot is immutable for the task's lifetime. Continuations read the stored snapshot and layer only explicit turn overrides on top — the snapshot itself is never modified.

## Settings scopes

### Global settings (`/settings`)

Applied in `#agent-chat` by the configured owner:

- `defaultProvider` — default for new projects
- `claudeModel` / `codexModel` — provider-specific model overrides
- `primaryAgentModel` — model used by the PM agent
- `claudeTimeoutMs` — maximum execution time for Claude tasks
- `usageReserve` — capacity reserved for PM operations
- `reasoningEfforts` — default reasoning depth per provider

### Project settings (`/project-settings`, `/model`, `/provider`)

Applied per project:

- `defaultProvider` — provider for new tasks in this project
- `claudeModel` / `codexModel` — project-level model overrides
- `reasoningEfforts` — per-provider reasoning depth
- `baseBranch` — Git branch used as the worktree base
- `mcpProfile` — named MCP tool profile
- `roborevEnabled` / `roborevChannelId` — code review integration
- `roborevChannelId` — channel for automated review posts

### Task snapshot

Persisted at task creation and immutable thereafter:

- `model` — resolved model identifier
- `reasoningEffort` — resolved reasoning depth
- `timeoutMs` — execution timeout
- `mcpProfile` — MCP profile name
- `approvalProfile` — approval behavior profile

## Provider-specific validation

Settings are validated against each provider's supported capabilities:

| Setting | Claude | Codex |
|---|---|---|
| `model` | Yes | Yes |
| `reasoningEffort` | No | Yes |
| `timeoutMs` | Yes | No |
| `mcpProfile` | Yes | No |
| `approvalProfile` | Yes | No |

Setting an unsupported value for a provider throws `UnsupportedAgentSettingError` before any provider turn begins.

# Settings Precedence

Agent settings flow through five levels. Each higher-priority level overrides the ones below it, while immutable task snapshots keep provider execution consistent across continuations.

## Precedence order

| Priority | Level | Source | Scope |
|---|---|---|---|
| 1 (highest) | Turn override | One-shot `/model <name> <prompt>` or continuation options | One provider turn |
| 2 | Task snapshot | Persisted at task creation | Entire durable task |
| 3 | Project settings | `/project-settings`, `/model`, `/provider` in a project channel | One project |
| 4 | Global settings | `/settings` and PM commands in `#agent-chat` | All projects / PM |
| 5 (lowest) | Host defaults | Environment variables and provider defaults | Host fallback |

## How task settings are resolved

When a task starts, `SettingsService.resolveTaskSettings()` merges:

1. host/provider defaults;
2. global provider settings from `runtime_settings`;
3. project settings from `projects` and `project_settings`;
4. explicit one-message overrides.

The resolved settings are persisted as `tasks.settings_json`. Continuations read that immutable snapshot and layer only explicit turn overrides on top.

## Global settings (`/settings`)

Applied in `#agent-chat` by the configured owner:

- `defaultProvider` — Claude, Codex, or OpenCode provider used by the PM and inherited by new projects;
- `claudeModel`, `codexModel`, `openCodeModel` — provider-specific model overrides;
- `primaryAgentModel` — PM-specific model override;
- `claudeTimeoutMs` — maximum Claude execution time;
- `usageReserve` — capacity reserved for coordination and recovery;
- `reasoningEfforts` — provider-scoped reasoning settings where supported.

Changing the default provider or PM model activates the new PM model transactionally. Failed activation restores both the stored settings and the prior PM service.

## Project settings

Applied by `/project-settings`, `/model`, and `/provider` in a project channel:

- `defaultProvider` — provider for new tasks;
- `claudeModel`, `codexModel`, `openCodeModel` — provider-scoped model overrides;
- `reasoningEfforts.codex` — Codex reasoning depth;
- `baseBranch` — Git base for future worktrees;
- `mcpProfile` — host-allowlisted Claude MCP profile.

Roborev channel identity and enablement remain owned by the channel lifecycle rather than the general settings service.

## PM model resolution

The PM model uses this order:

1. persisted `primaryAgentModel`;
2. persisted/provider-scoped global model;
3. provider-specific host PM setting (`OPENCODE_PRIMARY_MODEL` for OpenCode), then `PRIMARY_AGENT_MODEL`;
4. provider task default (`CLAUDE_MODEL`, `CODEX_MODEL`, or `OPENCODE_MODEL`);
5. provider-native default.

## Task snapshot

Persisted at task creation:

- `model`;
- `reasoningEffort`;
- `timeoutMs`;
- `mcpProfile`;
- `approvalProfile`.

## Provider-specific validation

| Setting | Claude | Codex | OpenCode |
|---|---:|---:|---:|
| `model` | Yes | Yes | Yes |
| `reasoningEffort` | No | Yes | No |
| `timeoutMs` | Yes | No | No |
| `mcpProfile` | Yes | No | No |
| `approvalProfile` | Task contract only | Task contract only | Task contract only |

Unsupported settings fail before a provider turn begins with `UnsupportedAgentSettingError`.

# Configuration

## Environment variables

### Required

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `DISCORD_TOKEN` | string | — | Discord bot token | Yes |

### Required for primary-agent and Codex auth

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `DISCORD_CLIENT_ID` | string | — | Discord application client ID | Yes |
| `DISCORD_GUILD_ID` | string | — | Discord server (guild) ID | Yes |
| `AUTHORIZED_ROLE_IDS` | string (comma-separated) | — | Discord role IDs authorized for project access | Yes |
| `AUTHORIZED_USER_ID` | string | `NOTIFY_USER_ID` | Exact owner for `#agent-chat` and Codex authentication | Yes |

### Optional — notification

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `NOTIFY_USER_ID` | string | empty | User ID to mention on task completion | No |

### Optional — security

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `PROJECTS_BASE_DIR` | string (path) | unrestricted | Restrict registered project paths to this directory | Yes |
| `ALLOW_NON_GIT` | boolean | `false` | Allow registration of non-Git directories (agent tasks still require Git) | Yes |

### Optional — Claude provider

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `CLAUDE_ENABLED` | boolean | `true` | Enable the Claude provider | Yes |
| `CLAUDE_MODEL` | string | SDK default | Default Claude task model | No |
| `CLAUDE_TIMEOUT_MS` | number | `900000` | Maximum Claude turn timeout in milliseconds | No |

### Optional — Codex provider

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `CODEX_ENABLED` | boolean | `true` | Enable the Codex provider | Yes |
| `CODEX_CLI_PATH` | string | `codex` | Codex CLI executable for App Server | Yes |
| `CODEX_MODEL` | string | provider default | Default Codex task model | No |

### Optional — OpenCode provider

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `OPENCODE_ENABLED` | boolean | `true` | Enable the OpenCode ACP provider | Yes |
| `OPENCODE_CLI_PATH` | string | `opencode` | OpenCode CLI executable | Yes |
| `OPENCODE_TIMEOUT_MS` | number | `900000` | OpenCode turn timeout in milliseconds | No |
| `OPENCODE_MODEL` | string | provider default | Default OpenCode task model | No |
| `OPENCODE_PRIMARY_MODEL` | string | global/provider default | OpenCode-specific PM-chat model | No |

### Optional — primary agent

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `PRIMARY_AGENT_MODEL` | string | provider default | Default PM-agent model for any provider | No |
| `PRIMARY_USAGE_RESERVE` | number (0–100) | `10` | Percentage of capacity reserved for PM operations | No |

### Optional — storage

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `DATABASE_PATH` | string (path) | `src/data/discordagent.sqlite` (dev), `dist/data/discordagent.sqlite` (built) | SQLite database file | Yes |
| `WORKTREES_BASE_DIR` | string (path) | `<db-dir>/discordagent-worktrees` | Base directory for Git worktrees | Yes |

### Optional — integrations

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `ROBOREV_CLI_PATH` | string | `roborev` | Roborev executable path | Yes |
| `USAGE_CHANNEL_ID` | string | empty | Channel ID for detailed usage posts | Yes |

### Optional — operations

| Variable | Type | Default | Purpose | Restart required |
|---|---|---|---|---|
| `INSTANCE_LOCK_PORT` | number | `47831` | Localhost TCP port used as single-instance lock | Yes |

## Configuration precedence

Settings are resolved at five levels (highest first):

1. **Turn override** — `/model <name> <prompt>` or continuation options
2. **Task snapshot** — persisted immutable at task creation
3. **Project settings** — `/project-settings`, `/model`, `/provider` in project channel
4. **Global settings** — `/settings` in `#agent-chat`
5. **Host defaults** — environment variables and provider defaults

Provider-specific setting support:

| Setting | Claude | Codex | OpenCode |
|---|---|---|---|
| `model` | Yes | Yes | Yes |
| `reasoningEffort` | No | Yes | No |
| `timeoutMs` | Yes | No | No |
| `mcpProfile` | Yes | No | No |

## Database

The SQLite database is created automatically on first run. Migrations are versioned and transactional. The current schema version is **9**.

## Environment variable drift

If `.env.example` and this reference disagree, `.env.example` is authoritative for defaults and this reference is authoritative for behavioral description. Report discrepancies as bugs.

# Configuration

Discord Agent reads host configuration from environment variables when the process starts. Changing an environment variable requires restarting the bot. Discord settings commands may override some model and provider defaults without changing the host environment.

## Environment variables

### Required

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `DISCORD_TOKEN` | string | — | Discord bot token | Yes |
| `DISCORD_CLIENT_ID` | string | — | Discord application ID used for command registration and connectivity checks | No |
| `DISCORD_GUILD_ID` | string | — | Private Discord server ID | No |
| `AUTHORIZED_ROLE_IDS` | comma-separated Discord role IDs | — | Roles allowed to use project and task functionality | No |

### Owner identity

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `AUTHORIZED_USER_ID` | Discord user ID | `NOTIFY_USER_ID` | Exact owner allowed to use `#agent-chat`, global settings, and Codex authentication controls | No |
| `NOTIFY_USER_ID` | Discord user ID | empty | User to mention when a task completes; also supplies the owner fallback when `AUTHORIZED_USER_ID` is omitted | No |

Set `AUTHORIZED_USER_ID` explicitly when using the PM-style primary agent or Codex authentication. Leaving both owner variables empty prevents owner-only flows from identifying an authorized owner.

### Security and project registration

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `PROJECTS_BASE_DIR` | absolute path | unrestricted | Restrict registered project paths to descendants of this directory | Potentially |
| `ALLOW_NON_GIT` | boolean | `false` | Allow registration of non-Git directories; agent tasks still require a Git repository | No |

### Claude provider

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `CLAUDE_ENABLED` | boolean | `true` | Enable Claude when its provider startup checks succeed | No |
| `CLAUDE_MODEL` | string | provider default | Host default Claude task model | No |
| `CLAUDE_TIMEOUT_MS` | integer milliseconds | `900000` | Claude turn timeout | No |

Claude authentication and user-level settings remain host-local. Project and local Claude settings are intentionally ignored by the runtime.

### Codex provider

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `CODEX_ENABLED` | boolean | `true` | Enable the Codex App Server provider | No |
| `CODEX_CLI_PATH` | executable path or command | `codex` | Codex CLI used to launch the local App Server | Potentially |
| `CODEX_MODEL` | string | provider default | Host default Codex task model | No |

Codex credentials and device-authentication state are managed by the Codex CLI on the bot host, not by environment variables stored in Discord Agent.

### OpenCode provider

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `OPENCODE_ENABLED` | boolean | `true` | Enable the OpenCode ACP provider | No |
| `OPENCODE_CLI_PATH` | executable path or command | `opencode` | OpenCode ACP provider executable | Potentially |
| `OPENCODE_TIMEOUT_MS` | integer milliseconds | `900000` | OpenCode task-turn timeout | No |
| `OPENCODE_MODEL` | string | provider default | Host default OpenCode task model | No |
| `OPENCODE_PRIMARY_MODEL` | string | provider/global default | OpenCode-specific model for PM-style primary-agent turns | No |

### Primary agent and usage admission

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `PRIMARY_AGENT_MODEL` | string | provider default | Optional host default model for PM-style primary-agent turns | No |
| `PRIMARY_USAGE_RESERVE` | number | `10` | Percentage points of provider capacity reserved for coordination and recovery | No |

### Factory Floor Activity adapter

The Factory Floor adapter is disabled unless `FACTORY_FLOOR_ENABLED=true`. Disabled or absent configuration does not affect Discord Agent startup or direct Claude, Codex, and OpenCode tasks.

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `FACTORY_FLOOR_ENABLED` | boolean | `false` | Enable Factory Floor adapter composition | No |
| `FACTORY_FLOOR_BASE_URL` | HTTP(S) URL | — | Factory Floor control-plane base URL | Potentially |
| `FACTORY_FLOOR_AGENT_TO_FACTORY_KEY` | string | — | Current HMAC key used only for Discord Agent-to-Factory Floor service requests | Yes |
| `FACTORY_FLOOR_FACTORY_TO_AGENT_KEY` | string | — | Current HMAC key used only for Factory Floor-to-Discord Agent callbacks | Yes |
| `FACTORY_FLOOR_PREVIOUS_AGENT_TO_FACTORY_KEY` | string | empty | Previous outgoing-direction key accepted during rotation overlap | Yes |
| `FACTORY_FLOOR_PREVIOUS_FACTORY_TO_AGENT_KEY` | string | empty | Previous callback-direction key accepted during rotation overlap | Yes |
| `FACTORY_FLOOR_OPERATOR_TOKEN` | string | empty | Optional least-privileged operator API token; never substitutes for service authentication | Yes |
| `FACTORY_FLOOR_REQUEST_TIMEOUT_MS` | integer milliseconds | `15000` | Per-request timeout for Factory Floor clients | No |
| `FACTORY_FLOOR_MAX_RETRIES` | integer `0`–`3` | `1` | Retry count for explicitly retryable read requests | No |

The two current directional HMAC keys must be different. Operator tokens, service-authentication keys, Activity session tokens, Discord OAuth credentials, and the Discord bot token are separate credential classes and must not reuse values.

Service authentication signs the protocol version, directional key identifier, timestamp, nonce, uppercase method, request path, and SHA-256 digest of the exact body bytes. The receiver enforces bounded clock skew, constant-time signature comparison, key-rotation overlap, and replay-nonce consumption.

Discord Agent SQLite stores only local project/surface/run linkage and bounded replay nonces. It does not store HMAC keys, signatures, operator tokens, Activity session tokens, Factory Floor events, approvals, artifacts, or runtime state.

### Storage

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `DATABASE_PATH` | path | runtime data directory | SQLite database file | Yes |
| `WORKTREES_BASE_DIR` | path | `discordagent-worktrees` beside `DATABASE_PATH` | Managed directory containing isolated task worktrees | Yes |

Development normally stores the database at `src/data/discordagent.sqlite`; compiled execution normally stores it at `dist/data/discordagent.sqlite`. A custom `DATABASE_PATH` changes the default worktree parent accordingly.

### Integrations and operations

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `ROBOREV_CLI_PATH` | executable path or command | `roborev` | Roborev executable | Potentially |
| `USAGE_CHANNEL_ID` | Discord channel ID | empty | Optional channel for detailed provider-usage posts | No |
| `INSTANCE_LOCK_PORT` | integer TCP port | `47831` | Loopback port used to prevent multiple bot processes from handling the same events | No |
| `TERMINAL_REPL_ENABLED` | boolean | `true` (only when both stdin and stdout are TTY) | Enable the interactive terminal REPL for the primary PM agent. Set to `false` to disable in CI or piped environments | No |

## Settings precedence

For supported task settings, precedence is highest to lowest:

1. A one-turn override supplied with the current prompt
2. The durable task's provider-scoped settings
3. Project settings
4. Global settings
5. Host environment defaults and provider defaults

Existing task threads retain their provider and durable session identity. Provider changes inside a task thread create a confirmed sibling handoff rather than converting the existing session.

## Provider setting capabilities

| Setting | Claude | Codex | OpenCode |
|---|---:|---:|---:|
| Model | Yes | Yes | Yes |
| Reasoning effort | No | Yes | No |
| Timeout | Yes | No | No |
| MCP profile | Yes | No | No |

## Database

The SQLite database is created automatically on first run. Migrations are versioned and transactional. The current schema version is documented in [Compatibility](compatibility.md).

## Source of truth

Runtime behavior in `src/config.ts` and adapter-specific validation in `src/factoryFloor/config.ts` are authoritative. This reference and `.env.example` must agree with them. Treat any discrepancy among the implementation, this page, and `.env.example` as a documentation or configuration bug rather than choosing one documentation file as a competing source of truth.

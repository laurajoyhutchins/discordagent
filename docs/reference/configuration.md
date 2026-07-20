# Configuration

Discord Agent reads host configuration from environment variables when the process starts. Changing an environment variable requires restarting the bot. Discord settings commands may override some model and provider defaults without changing the host environment.

## Environment variables

### Required

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `DISCORD_TOKEN` | string | — | Discord bot token | Yes |
| `DISCORD_CLIENT_ID` | string | — | Discord application ID used for command registration, connectivity checks, and trusted Activity launch binding | No |
| `DISCORD_GUILD_ID` | string | — | Private Discord server ID and trusted Activity guild boundary | No |
| `AUTHORIZED_ROLE_IDS` | comma-separated Discord role IDs | — | Roles allowed to use project, task, and Activity launch functionality | No |

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
| `OPENCODE_CLI_PATH` | executable path or command | `opencode` | OpenCode CLI executable | Potentially |
| `OPENCODE_TIMEOUT_MS` | integer milliseconds | `900000` | OpenCode task-turn timeout | No |
| `OPENCODE_MODEL` | string | provider default | Host default OpenCode task model | No |
| `OPENCODE_PRIMARY_MODEL` | string | provider/global default | OpenCode-specific model for PM-style primary-agent turns | No |

### Provider readiness

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `REQUIRED_PROVIDERS` | comma-separated provider IDs | empty | Require specific providers to pass `smoke:host`; valid IDs are `claude`, `codex`, and `opencode` | No |

`npm run smoke:host` reports `READY` when at least one enabled provider executable is available and all explicitly required providers are available. Additional enabled but unavailable providers are warnings with install, authenticate, or disable guidance. Disabled providers are reported without being probed.

Set `REQUIRED_PROVIDERS` for a deployment that depends on a particular provider:

```bash
REQUIRED_PROVIDERS=codex npm run smoke:host
```

Multiple requirements use commas, such as `claude,codex`. Requiring a disabled or unavailable provider makes preflight fail even when another provider is available. Unknown provider IDs are configuration failures.

The deterministic host preflight does not make a paid model call. It reports authentication when a provider probe can determine it; otherwise it states that authentication was not verified. Use `npm run smoke:agent -- --provider <provider>` for the live authenticated round trip.

### Primary agent and usage admission

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `PRIMARY_AGENT_MODEL` | string | provider default | Optional host default model for PM-style primary-agent turns | No |
| `PRIMARY_USAGE_RESERVE` | number | `10` | Percentage points of provider capacity reserved for coordination and recovery | No |

### Factory Floor Activity adapter

The Factory Floor adapter is disabled unless `FACTORY_FLOOR_ENABLED=true`. Disabled or absent configuration does not affect Discord Agent startup or direct Claude, Codex, and OpenCode tasks. Valid enabled configuration also reconciles the single global `factory-floor` Activity Entry Point after normal guild commands are registered.

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `FACTORY_FLOOR_ENABLED` | boolean | `false` | Enable Factory Floor adapter composition and global Activity Entry Point reconciliation | No |
| `FACTORY_FLOOR_BASE_URL` | HTTP(S) origin | — | Factory Floor control-plane origin, without credentials, path, query, or fragment | Potentially |
| `FACTORY_FLOOR_AGENT_TO_FACTORY_KEY` | string | — | Current HMAC key used only for Discord Agent-to-Factory Floor service requests | Yes |
| `FACTORY_FLOOR_FACTORY_TO_AGENT_KEY` | string | — | Current HMAC key used only for Factory Floor-to-Discord Agent callbacks | Yes |
| `FACTORY_FLOOR_PREVIOUS_AGENT_TO_FACTORY_KEY` | string | empty | Previous outgoing-direction key accepted during rotation overlap | Yes |
| `FACTORY_FLOOR_PREVIOUS_FACTORY_TO_AGENT_KEY` | string | empty | Previous callback-direction key accepted during rotation overlap | Yes |
| `FACTORY_FLOOR_OPERATOR_TOKEN` | string | empty | Optional least-privileged operator API token; never substitutes for service authentication | Yes |
| `FACTORY_FLOOR_REQUEST_TIMEOUT_MS` | positive integer milliseconds | `15000` | Per-request timeout for Factory Floor clients | No |
| `FACTORY_FLOOR_MAX_RETRIES` | integer `0`–`3` | `1` | Retry count for explicitly retryable read requests | No |
| `FACTORY_FLOOR_LAUNCH_TTL_MS` | integer `30000`–`600000` milliseconds | `120000` | Lifetime of a one-time trusted Activity launch registration | No |

Current and previous keys within one direction must be different, and no key value may appear in both directions. Operator tokens, service-authentication keys, Activity session tokens, Discord OAuth credentials, and the Discord bot token are separate credential classes and must not reuse values.

Service authentication signs the protocol version, directional key identifier, timestamp, nonce, uppercase method, request path, and SHA-256 digest of the exact body bytes. The receiver enforces bounded clock skew, constant-time signature comparison, key-rotation overlap, and replay-nonce consumption.

Discord Agent SQLite stores local project/surface/run linkage, validated Activity instance linkage, bounded replay nonces, and short-lived one-time launch registrations. It does not store HMAC keys, signatures, operator tokens, Activity session tokens, Factory Floor events, approvals, artifacts, or runtime state. Launch registrations are bound to the configured application and guild, current Discord principal and surface, and server-resolved project/run context; browser-selected authority is never persisted.

### Factory Floor Activity bootstrap broker

The HTTPS broker is independently disabled unless `FACTORY_FLOOR_BROKER_ENABLED=true`. It also requires the Factory Floor adapter. Broker configuration failures are logged and isolated from Discord Gateway and direct-provider operation.

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `FACTORY_FLOOR_BROKER_ENABLED` | boolean | `false` | Start the optional OAuth/bootstrap and mutation-revalidation HTTPS listener | No |
| `FACTORY_FLOOR_BROKER_HOST` | host | `127.0.0.1` | Listener bind address | No |
| `FACTORY_FLOOR_BROKER_PORT` | integer `1`–`65535` | `8443` | Listener port | No |
| `FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN` | HTTPS origin | — | Public broker origin used to construct request URLs | No |
| `FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS` | comma-separated HTTPS origins | — | Exact Activity origins allowed by CORS | No |
| `FACTORY_FLOOR_BROKER_REDIRECT_URIS` | comma-separated HTTPS URLs | — | Exact OAuth callback allowlist | No |
| `FACTORY_FLOOR_BROKER_TLS_CERT_PATH` | file path | — | TLS certificate chain | Potentially |
| `FACTORY_FLOOR_BROKER_TLS_KEY_PATH` | file path | — | TLS private key | Yes |
| `DISCORD_CLIENT_SECRET` | string | — | Server-only Discord OAuth application credential | Yes |
| `FACTORY_FLOOR_BROKER_OAUTH_SCOPES` | comma-separated scopes | `identify` | OAuth scopes requested by the Activity | No |
| `FACTORY_FLOOR_BROKER_OAUTH_TTL_MS` | integer `30000`–`600000` | `60000` | PKCE attempt lifetime, capped by launch expiry | No |
| `FACTORY_FLOOR_BROKER_REQUEST_TIMEOUT_MS` | integer `1`–`60000` | `10000` | Discord API and current-member revalidation timeout | No |
| `FACTORY_FLOOR_BROKER_MAX_RESPONSE_BYTES` | integer `1024`–`1048576` | `32768` | Maximum Discord response body | No |
| `FACTORY_FLOOR_BROKER_MAX_BODY_BYTES` | integer `1024`–`65536` | `8192` | Maximum browser or service request body | No |
| `FACTORY_FLOOR_BROKER_REVALIDATION_MAX_REQUESTS` | integer `1`–`1000` | `30` | Maximum revalidation requests per principal and action in one fixed window | No |
| `FACTORY_FLOOR_BROKER_REVALIDATION_RATE_LIMIT_WINDOW_MS` | integer `1000`–`3600000` | `60000` | Fixed-window duration for principal/action revalidation limits | No |

Browser OAuth routes return JSON with no-store headers and exact-origin CORS. The reverse revalidation route does not use browser CORS; Factory Floor signs its exact request body with the `ff-to-agent` key and `x-factory-floor-service-auth` header. It re-fetches the live Activity instance and current guild member immediately before an `approve` or `cancel` mutation, then verifies application, installation, guild, Activity location and participant, role authorization, adapter, project, surface, and run bindings. The response contains only a stable reason code and minimal attribution. See [Discord Activity OAuth bootstrap](discord-activity-bootstrap.md) and [Discord Activity mutation revalidation](discord-activity-revalidation.md).

### Storage

| Variable | Type | Default | Purpose | Sensitive |
|---|---|---|---|---|
| `DATABASE_PATH` | path | `<repository>/data/discordagent.sqlite` | SQLite database file | Yes |
| `WORKTREES_BASE_DIR` | path | `discordagent-worktrees` beside `DATABASE_PATH` | Managed directory containing isolated task worktrees | Yes |

Fresh installations use the same repository-root `data/` directory under `npm run dev`, compiled `npm start`, and `npm run smoke:host`. The database, legacy `projects.json` import file, and default managed-worktree directory all derive from that selected data root.

For compatibility, a sole historical `src/data` or `dist/data` installation is reused in place without moving or copying state. Startup and host preflight report that compatibility selection. If more than one default data root contains a database, legacy project file, or managed-worktree directory, Discord Agent fails closed instead of choosing silently. Set `DATABASE_PATH` to the intended database before restarting; `WORKTREES_BASE_DIR` may be set separately when its location should not remain beside that database.

Explicit non-empty `DATABASE_PATH` and `WORKTREES_BASE_DIR` values always take precedence. Relative explicit paths retain their existing process-working-directory semantics; absolute paths are recommended for service-manager deployments.

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

Runtime behavior in `src/config.ts`, provider host defaults in `src/agents/providerConfiguration.ts`, application paths in `src/utils/applicationPaths.ts`, adapter validation in `src/factoryFloor/config.ts`, and broker validation in `src/factoryFloor/activityBootstrapConfig.ts` are authoritative. This reference and `.env.example` must agree with them. Treat any discrepancy among the implementation, this page, and `.env.example` as a documentation or configuration bug.

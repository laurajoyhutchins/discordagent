# Security Model

## Credential safety

Credentials, API keys, secrets, and authentication tokens are never sent to Discord, logged, or persisted to SQLite.

### Redaction boundary

All provider output, error messages, and log data pass through `src/utils/redaction.ts` before reaching Discord or storage. The redaction engine matches:

- API keys (`sk-...`, `ghp_...`, etc.)
- Bearer tokens
- Credential assignments (`API_KEY=value`, `password=value`, etc.)
- Device codes and verification URLs
- JSON serialized secrets with sensitive keys

Redacted values are replaced with `[REDACTED]`.

### Authentication

- Codex device authentication is host-local. The verification URL and one-time code are never sent to Discord. `/codex-auth login` only starts the in-memory flow and provides local-host instructions.
- Login details are memory-only, expire automatically after 30 minutes, and are cleared on completion, cancellation, logout, or shutdown.
- The bot performs a fresh account read after authentication and requires an explicit **Start task** or **Discard** action.

### Persistence

- Provider sessions are stored in SQLite with session IDs only — no credentials or tokens.
- Roborev webhook tokens are never created, stored, or transmitted. Roborev messages are sent through the authenticated bot client.
- Usage snapshots are redacted before storage.

## Authorization

### Global commands

`/settings` and `/codex-auth` are owner-only. The owner is identified by the `AUTHORIZED_USER_ID` environment variable.

### Project commands

`/project-settings`, `/provider`, and `/model` within project channels are authorized by configured role IDs (`authorizedRoleIds`). Any member with a matching role can view or change project settings.

### Task commands

Task operations (`/cancel`, continuation via message) are authorized per-channel. Only members with access to the task thread can interact with it.

### Provider onboarding

Provider selection buttons in `#agent-chat` verify:
1. The clicking user is the configured owner
2. The interaction comes from the correct channel
3. The bot message is the current setup prompt
4. The message author is the bot itself

Stale or forged interactions are rejected with a message directing the user to run the appropriate command.

## Discord permissions

The bot runs with least-privilege permissions. The required Gateway intents are `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent`. The runtime permission profile is:

| Permission | Purpose |
|---|---|
| View Channel | Read private project/task channels |
| Send Messages | Reply and publish task output |
| Embed Links | Richer status and result cards (plain-text fallback available) |
| Read Message History | Inspect task-thread context |
| Create Public Threads | Create one thread for each new task |
| Send Messages in Threads | Publish control cards, output, and decisions |

Optional permissions include `Pin Messages` (for pinned control cards) and `Send Polls` (for native polls). Each optional capability has a graceful fallback.

The bot must never be granted `Administrator`.

## Provider output safety

Provider output is treated as untrusted. Task coordinator methods:

- Redact sensitive text from events before storing in SQLite and rendering to Discord
- Redact error messages before replying to users
- Validate thread names against sensitive content
- Sanitize Git branch and worktree paths

## Recovery safety

- No provider turn is replayed automatically after an interruption.
- Dirty worktrees are never removed.
- Task worktrees are preserved for inspection even after task completion.
- Only worktrees within the managed base directory can be removed.

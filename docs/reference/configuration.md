# Configuration

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application client ID |
| `DISCORD_GUILD_ID` | Yes | — | Discord server (guild) ID |
| `AUTHORIZED_ROLE_IDS` | Yes | — | Comma-separated Discord role IDs authorized for project access |
| `AUTHORIZED_USER_ID` | PM/Codex auth | `NOTIFY_USER_ID` | Exact owner authorized for `#agent-chat` and Codex authentication |
| `NOTIFY_USER_ID` | No | — | User ID to mention on task completion |
| `PROJECTS_BASE_DIR` | No | unrestricted | Optional parent-directory boundary for registered repositories |
| `DATABASE_PATH` | No | runtime data directory | SQLite database file path |
| `WORKTREES_BASE_DIR` | No | `<db-dir>/discordagent-worktrees` | Base directory for Git worktrees |
| `CLAUDE_ENABLED` | No | `true` | Enable the Claude provider |
| `CLAUDE_MODEL` | No | provider default | Default Claude task model |
| `CLAUDE_TIMEOUT_MS` | No | `900000` | Default Claude task timeout in milliseconds |
| `CODEX_ENABLED` | No | `true` | Enable the Codex provider |
| `CODEX_CLI_PATH` | No | `codex` | Codex CLI executable used to launch App Server |
| `CODEX_MODEL` | No | provider default | Default Codex task model |
| `OPENCODE_ENABLED` | No | `true` | Enable the OpenCode ACP provider |
| `OPENCODE_CLI_PATH` | No | `opencode` | OpenCode CLI executable |
| `OPENCODE_TIMEOUT_MS` | No | `900000` | OpenCode task timeout in milliseconds |
| `OPENCODE_MODEL` | No | provider default | Default OpenCode task model |
| `OPENCODE_PRIMARY_MODEL` | No | global/provider fallback | OpenCode-specific PM-chat model |
| `PRIMARY_AGENT_MODEL` | No | provider default | Default PM-agent model for any provider |
| `PRIMARY_USAGE_RESERVE` | No | `10` | Percentage points reserved for PM operations |
| `ROBOREV_CLI_PATH` | No | `roborev` | Roborev executable path |
| `USAGE_CHANNEL_ID` | No | — | Optional detailed usage channel |
| `ALLOW_NON_GIT` | No | `false` | Allow registration of non-Git directories; agent tasks still require Git worktrees |

Disable providers that are not installed on the host. `npm run smoke:host` treats a missing Codex or OpenCode CLI as a failure when its provider remains enabled and as a warning when disabled.

## Claude MCP servers

MCP servers are loaded from `~/.claude/settings.json` under `mcpServers`. Only user-level settings are used; project/local Claude settings are ignored.

Servers named `default` and `disabled` are reserved for profile resolution:

- **default** — all host-allowlisted servers
- **disabled** — no MCP servers

Every other server name becomes a selectable single-server MCP profile in `/project-settings`.

## Database

The SQLite database is created automatically on first run. Migrations are versioned and transactional. Provider-constraint rebuilds temporarily disable SQLite foreign-key enforcement, run `foreign_key_check` before commit, and restore the prior pragma value.

## Discord permissions

See [Capability Model](../explanation/capability-model.md) for the complete permission breakdown.

Required Gateway intents (enable in Discord Developer Portal):

- `Guilds`
- `GuildMessages`
- `GuildMembers` (privileged)
- `MessageContent` (privileged)

Required bot permissions at guild level:

- View Channel
- Send Messages
- Embed Links
- Read Message History
- Create Public Threads
- Send Messages in Threads

Use the permission calculator to print exact values:

```bash
npm run discord:permissions
```

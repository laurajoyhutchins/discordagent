# Configuration

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application client ID |
| `GUILD_ID` | Yes | — | Discord server (guild) ID |
| `PROJECTS_BASE_DIR` | Yes | — | Base directory for project repositories |
| `AUTHORIZED_USER_ID` | Yes | — | Discord user ID authorized for owner commands |
| `NOTIFY_USER_ID` | No | — | User ID to ping on task completion |
| `DATABASE_PATH` | No | `src/data/discordagent.sqlite` | SQLite database file path |
| `WORKTREES_BASE_DIR` | No | `<db-dir>/discordagent-worktrees` | Base directory for Git worktrees |
| `CLAUD_ENABLED` | No | `true` | Enable Claude provider |
| `CODE_ENABLED` | No | — | Enable Codex provider |
| `CLAUD_MODEL` | No | — | Default Claude model |
| `CODE_MODEL` | No | — | Default Codex model |
| `PRIMARY_AGENT_MODEL` | No | — | Default primary agent model |
| `CLAUD_TIMEOUT_MS` | No | `300000` (5 min) | Default Claude task timeout |
| `PRIMARY_USAGE_RESERVE` | No | `10` | Percentage reserved for PM operations |
| `CODEX_CLI_PATH` | No | `codex` | Path to the Codex CLI executable |
| `AUTHORIZED_ROLE_IDS` | No | — | Comma-separated Discord role IDs for project access |

## Claude MCP servers

MCP servers are loaded from `~/.claude/settings.json` `mcpServers`. Only user-level settings are used; project/local Claude settings are ignored.

Servers named `default` and `disabled` are reserved for profile resolution:

- **default** — included in every profile
- **disabled** — excluded from every profile

Other server names become selectable MCP profiles in `/project-settings`.

## Database

The SQLite database is created automatically on first run. Migrations are versioned and run transactionally. The database file location is configurable via `DATABASE_PATH`.

## Discord permissions

See [Capability Model](/docs/explanation/capability-model.md) for the complete permission breakdown.

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

# How to diagnose Discord connectivity

Verify that the bot can authenticate, read your server, and that all expected commands are registered.

## Prerequisites

- `.env` configured with `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and `AUTHORIZED_ROLE_IDS`
- Slash commands registered (`npm run register`)

## Procedure

### 1. Run the host preflight

```bash
npm run smoke:host
```

This validates environment variables, snowflake formats, directory writability, and CLI availability before any Discord call. Resolve all failures.

### 2. Run the Discord connectivity check

```bash
npm run smoke:discord
```

This performs read-only verification:

- Authenticates as the bot user via the Discord REST API
- Confirms the bot user ID matches `DISCORD_CLIENT_ID`
- Reads the guild and confirms it matches `DISCORD_GUILD_ID`
- Checks that every role in `AUTHORIZED_ROLE_IDS` exists in the guild
- Verifies all 14 slash commands are registered

The bot token and IDs are never printed.

### 3. Interpret the results

Expected output resembles:

```text
Connected as BotName (123456789012345678)
Guild: My Server (876543210987654321)
Authorized roles: RoleName (role-id-1), RoleName2 (role-id-2)
Registered commands: add-project, list-projects, remove-project, cancel, ...
```

Common failures:

| Symptom | Likely cause |
|---|---|
| `401: Unauthorized` | `DISCORD_TOKEN` is invalid or was reset |
| `Client ID mismatch` | `DISCORD_CLIENT_ID` does not match the token's application |
| `Guild not found` | `DISCORD_GUILD_ID` is wrong or the bot is not in that guild |
| `Role not found` | A role ID in `AUTHORIZED_ROLE_IDS` does not exist in the guild |
| `Missing commands` | Run `npm run register` again |

## Related

- [Create and install the bot](create-and-install-the-bot.md)
- [Tutorial: run your first agent task](../../tutorials/run-your-first-agent-task.md)

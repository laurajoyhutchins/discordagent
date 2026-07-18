# Troubleshooting

## Bot won't start

### "Missing required permissions"

The bot's guild-level permissions are insufficient. Check:

1. The bot has the required intents enabled in the Discord Developer Portal
2. The bot has been granted the correct guild permissions
3. The bot's role is high enough in the server role list

Run `npm run discord:permissions` for exact values, then `/capabilities` after starting.

### "Single-instance lock held"

Another bot process is running. Stop the other process or wait for the lock to expire.

### Database errors

Check the database path (`DATABASE_PATH`) is writable. Migrations run automatically on first start.

## Tasks

### Task won't start

Common causes:

- **Provider unavailable** — check `/codex-auth status` for Codex, or verify Claude is authenticated locally
- **Missing Discord permissions** — run `/capabilities` in the project channel
- **Usage limit reached** — check `/usage` for rate-limit status

### Task stuck on "starting"

The provider may be slow to initialize. If it persists:

1. Check provider authentication
2. Check bot host logs for errors
3. Use `/cancel` to abort and retry

### Task interrupted after restart

Nonterminal tasks become `interrupted` after a bot restart. The bot posts a recovery checkpoint in the task thread with the worktree location and events so far. No provider turn is replayed automatically. Send a new message in the thread to resume.

### "Worktree not found"

The worktree directory may have been deleted manually. The task record remains but cannot be continued. Close the task with `/close` and start a new one.

## Discord

### Control card not pinned

The bot may lack `Pin Messages` permission. Run `/capabilities` to check. The card still works unpinned.

### Control card shows wrong state

Wait for the next card update. Card updates are coalesced: rapid state changes produce one edit. If the issue persists, restart the bot.

### "Stale or unexpected controls" error

The bot message was sent by a different version of the bot or the interaction was forged. Run the original command again to generate a fresh message.

## Provider

### "Provider unavailable" in project channel

The provider is not registered or not authenticated. Check:

1. The provider is installed on the bot host
2. Codex is authenticated (`/codex-auth status`)
3. The provider is enabled in configuration

### "Unsupported setting" error

You tried to set a provider-specific value on a provider that doesn't support it. For example, `reasoningEffort` is supported by Codex but not Claude.

### Codex authentication fails

1. Ensure the Codex CLI is installed and in PATH
2. Run `/codex-auth login` then `codex login --device-auth` on the host
3. Complete the browser flow and click **Check again** in Discord
4. Authentication expires after 30 minutes if not completed

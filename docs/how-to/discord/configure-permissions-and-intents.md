# How to configure permissions and intents

Set up the least-privilege Discord permission profile.

## Prerequisites

- The bot must be created and invited to the server (see [create and install the bot](create-and-install-the-bot.md))
- Server role with **Manage Server** and **Manage Roles** permissions

## Procedure

### 1. Enable Gateway intents

In the [Discord Developer Portal](https://discord.com/developers/applications), select your application, go to **Bot > Privileged Gateway Intents**, and enable:

- **Server Members Intent**
- **Message Content Intent**

Both are required. They cannot be set from the bot's code.

### 2. Set guild-level bot permissions

The bot must have these permissions at the **guild level** (Server Settings > Roles > bot role). Channel overwrites cannot grant permissions the bot does not possess.

**Runtime profile** (always required):

| Permission | Purpose |
|---|---|
| View Channel | Read private project and task channels |
| Send Messages | Reply and publish task output |
| Embed Links | Richer status and result cards (plain-text fallback if missing) |
| Read Message History | Inspect task-thread context |
| Create Public Threads | Create one thread for each new task |
| Send Messages in Threads | Publish control cards, output, and decisions |

**Bootstrap profile** (only needed during channel setup):

| Permission | Purpose |
|---|---|
| Manage Channels | Create project categories, channels, and permission overwrites |

Remove `Manage Channels` after initial setup if project management is no longer needed.

### 3. Optional permissions

Each optional feature has a graceful fallback when its permission is missing:

| Feature | Permission | Fallback |
|---|---|---|
| Pinned control cards | Pin Messages | Cards remain unpinned |
| Native polls | Send Polls | Polls not offered |
| Audit log reconciliation | View Audit Log | Feature disabled |
| Webhook personas | Manage Webhooks | Feature disabled |

**Do not grant Administrator.** It is neither required nor recommended.

### 4. Verify permissions

Run `/capabilities` in any channel to see an ephemeral report of effective permissions, fallbacks, and intents.

## Verification

```bash
npm run discord:permissions
```

This prints the calculated permission integers, intents, scopes, and an invite URL.

## Troubleshooting

- **"Missing required permissions" on startup** — the bot lacks `Manage Channels` at guild level for channel creation.
- **Embed links not working** — the bot lacks `Embed Links`; falls back to plain text.
- **Tasks fail with permission errors** — run `/capabilities` in the project channel to see effective permissions.

## Reference

- [Discord capabilities reference](../../reference/discord-capabilities.md)
- [Command reference: `/capabilities`](../../reference/commands.md#capabilities)

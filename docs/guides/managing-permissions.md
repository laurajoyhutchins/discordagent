# Managing Discord Permissions

## Quick start

Use the permission calculator to print exact values:

```bash
npm run discord:permissions
```

This outputs permission integers, Gateway intents, OAuth scopes, application settings, and an invite URL.

## Required permissions

### Gateway intents

Enable these in the Discord Developer Portal under **Bot > Privileged Gateway Intents**:

- **Server Members Intent** — required for role-based authorization
- **Message Content Intent** — required to read task prompts

These are privileged intents and must be explicitly enabled. They cannot be set via the bot's code.

### Bot permissions (guild level)

The runtime profile requires these permissions at the guild level. Channel overwrites cannot grant permissions the bot does not have:

| Permission | Purpose |
|---|---|
| View Channel | Read private project/task channels |
| Send Messages | Reply and publish task output |
| Embed Links | Richer status and result cards (plain-text fallback available) |
| Read Message History | Inspect task-thread context |
| Create Public Threads | Create one thread for each new task |
| Send Messages in Threads | Publish control cards, output, and decisions |

### Bootstrap permissions

Channel creation (`/add-project`) additionally requires `Manage Channels`. This permission can be removed after initial setup if project management is no longer needed.

## Optional permissions

Each optional feature has a graceful fallback:

| Feature | Permission | Fallback |
|---|---|---|
| Pinned control cards | Pin Messages | Cards remain unpinned |
| Native polls | Send Polls | Polls not offered |
| Audit log reconciliation | View Audit Log | Features disabled |
| Webhook personas | Manage Webhooks | Features disabled |

## Checking capabilities

Run `/capabilities` in any channel for an ephemeral report showing which capabilities are available, which are missing, and how the bot will fall back.

## Troubleshooting

### "Missing required permissions" on startup

The bot checks bootstrap permissions before creating channels. Check that the bot has `Manage Channels` at the guild level.

### "Missing channel permissions" on startup

The bot checks that it can see and write to `#agent-chat`. Ensure the bot has `View Channel`, `Send Messages`, and `Read Message History` in that channel.

### Embed links not working

If the bot lacks `Embed Links`, control cards and result messages fall back to plain text. Run `/capabilities` to confirm the permission state.

### Tasks fail with permission errors

Run `/capabilities` in the project channel. If task thread permissions are missing, the coordinator rejects task creation before any provider turn begins.

# Discord capabilities

## Required Gateway intents

Enable these in the [Discord Developer Portal](https://discord.com/developers/applications) under **Bot > Privileged Gateway Intents**:

| Intent | Purpose | Privileged |
|---|---|---|
| `Guilds` | Receive guild and channel events | No |
| `GuildMessages` | Receive message events | No |
| `GuildMembers` | Role-based authorization | Yes |
| `MessageContent` | Read task prompts | Yes |

Intents are defined in `PROCESS_GATEWAY_INTENTS` in the capability registry and applied at client creation. They cannot be set from code — they must be enabled in the Developer Portal.

## Required bot permissions

These must be granted at the guild level and remain available through effective channel overwrites:

| Permission | Purpose | Fallback if missing |
|---|---|---|
| View Channel | Read private channels | Bot cannot operate |
| Send Messages | Reply and publish output | Bot cannot operate in ordinary text channels |
| Read Message History | Inspect task thread context | Bot cannot operate |
| Create Public Threads | One thread per task | Bot cannot operate |
| Send Messages in Threads | Publish in task threads | Bot cannot operate in task threads |

## Bootstrap permissions

Required only during channel creation:

| Permission | Purpose |
|---|---|
| Manage Channels | Create project categories, channels, permission overwrites |

Remove after initial setup if project management is no longer needed.

## Optional permissions

| Permission | Feature | Fallback |
|---|---|---|
| Embed Links | Rich task cards, RoboRev notifications, and scheduled-loop lifecycle messages | Bounded plain text; loop controls remain attached where components are supported |
| Pin Messages | Pinned control cards | Cards remain unpinned |
| Send Polls | Native polls | Polls not offered |
| View Audit Log | Audit reconciliation | Feature disabled |
| Manage Webhooks | Webhook personas | Feature disabled |
| Create Events | Scheduled events | Feature disabled |
| Connect / Speak | Live voice | Feature disabled |
| Send Voice Messages | Voice messages | Feature disabled |
| Set Voice Channel Status | Voice status | Feature disabled |

Discord Agent evaluates effective channel permissions before known capability-dependent sends. When Embed Links is known unavailable, it sends the text projection directly. If Discord rejects a rich payload despite the capability check, the delivery boundary retries once with bounded plain text and preserves interactive components such as **Stop Loop**. A failure of both rich and text delivery is logged as a real send failure rather than reported as successful delivery.

## OAuth scopes

| Scope | Purpose |
|---|---|
| `bot` | Add the bot to a server |
| `applications.commands` | Register slash commands |

## Application configuration

- Message Content Intent — must be enabled in Developer Portal
- Server Members Intent — must be enabled in Developer Portal
- Activities — require application configuration and an Entry Point command
- `Use Embedded Activities`, `Use Application Commands`, `Use External Apps` — member-behavior permissions, not bot-role requirements

## Capability registry

The capability registry (`src/discord/capabilities/registry.ts`) provides stable capability IDs, diagnostic reports, and graceful fallbacks. Run `/capabilities` in any channel for an ephemeral report.

## Never grant Administrator

The `Administrator` permission is neither required nor recommended. The permission calculator intentionally excludes it.

## Calculating exact values

```bash
npm run discord:permissions
```

This prints the permission integer, Gateway intents, OAuth scopes, and an invite URL for each profile.

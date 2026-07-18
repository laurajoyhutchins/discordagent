# Capability Model

Discord Agent uses a capability registry to decouple feature checks from hardcoded permission flags. This model provides diagnostics, graceful fallbacks, and least-privilege guidance.

## Capability registry

Each capability has a stable ID, a name, an associated Discord permission bit, and a category:

```
core.channel.view        → View Channel
core.message.send        → Send Messages
core.message.embed       → Embed Links
core.message.history     → Read Message History
task.thread.create       → Create Public Threads
task.thread.send         → Send Messages in Threads
task.control-card.pin    → Pin Messages
core.poll.send           → Send Polls
```

Capabilities are registered in `src/discord/capabilities/registry.ts` and are stable across versions.

## Profiles

Profiles bundle capabilities into named sets used during channel setup:

| Profile | Capabilities | Purpose |
|---|---|---|
| `bootstrap` | Channel management, message send, thread creation | Initial channel creation |
| `runtime` | View, send, embed, history, thread create/send | Normal operation |
| `audio` | Connect, speak, voice states | Voice features (optional) |
| `admin` | View audit log, manage webhooks | Administrative features (optional) |

Profiles are used by `channelManager.ts` to derive bot permission overwrites. A capability not available at guild level will be excluded from the overwrite — channel overwrites cannot grant permissions the bot doesn't possess.

## Evaluation

The evaluator (`src/discord/capabilities/evaluator.ts`) checks each capability against:

1. The bot's guild-level permissions
2. Channel-specific permission overwrites
3. Configured Gateway intents

Each capability returns a state:

- `available` — the capability is usable
- `unavailable` — the capability is missing and there is no fallback
- `not_applicable` — the capability does not apply in this context
- `cannot_determine` — permission state cannot be determined (e.g., no guild member)

## Fallback behavior

When a capability is unavailable, the system degrades gracefully:

| Missing capability | Fallback |
|---|---|
| `Embed Links` | Plain-text control cards and result messages |
| `Pin Messages` | Control cards remain unpinned |
| `Send Polls` | Polls are not offered as an interaction |

The `/capabilities` command reports the effective state of every capability in the current channel, including fallback behavior.

## Permission configuration

Use the permission calculator to see exact values:

```bash
npm run discord:permissions
```

The runtime profile requires these Gateway intents:

- `Guilds`
- `GuildMessages`
- `GuildMembers` (privileged)
- `MessageContent` (privileged)

The `GuildMembers` and `MessageContent` intents must be enabled in the Discord Developer Portal under **Bot > Privileged Gateway Intents**.

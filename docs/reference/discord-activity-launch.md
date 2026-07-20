# Discord Activity launch registration

This reference records the Discord platform contract used by the Factory Floor Activity launch boundary. It was reverified against the official Discord and discord.js documentation on **July 19, 2026**.

## Registered command

Discord Agent reconciles one global application command when the Factory Floor adapter is enabled:

| Field | Value |
|---|---|
| Name | `factory-floor` |
| Command type | `PRIMARY_ENTRY_POINT` (`4`) |
| Handler | `APP_HANDLER` (`1`) |
| Installation type | Guild install only (`0`) |
| Interaction context | Guild only (`0`) |

Discord permits one global Primary Entry Point command per application. If Discord already created the default Activity Entry Point, Discord Agent adopts and edits it rather than creating a duplicate. The adopted command ID is recorded in SQLite runtime settings so disabling the adapter removes only the command owned by Discord Agent.

Startup reconciliation is idempotent. An exact command is left unchanged; a missing command is created; a stale command is edited; multiple Primary Entry Point commands fail closed and are not mutated.

## Interaction acknowledgement

`APP_HANDLER` sends the Entry Point interaction to Discord Agent. After server-side authorization and context resolution, Discord Agent acknowledges it with the `LAUNCH_ACTIVITY` interaction callback (`12`).

The callback contains no application-defined data payload. In particular, it cannot carry authoritative project, run, principal, guild, channel, or thread identifiers. Discord Agent therefore resolves and persists all trusted launch context before sending `LAUNCH_ACTIVITY`.

If Discord rejects the acknowledgement, the prepared one-time launch state is invalidated and the user receives an ephemeral plain-text failure. No Activity is advertised when the adapter is disabled or invalid.

## Trusted context

A launch registration is bound to:

- Discord application ID;
- guild installation type and installation owner;
- configured guild ID;
- current channel and optional task thread;
- current authorized Discord principal;
- registered local project and Factory Floor project binding;
- optional exact surface and active run;
- source interaction ID;
- creation and expiration times.

Project and run identifiers are never accepted from browser input. A project channel with no active run opens project context. A project channel with exactly one active run binds that run. More than one active run is ambiguous and requires launching from the specific task thread. A task thread requires an exact active surface/run binding.

## One-time state

Migration 12 stores short-lived opaque launch registrations in `factory_floor_launch_states`.

- Interaction retries are idempotent only when every stored field is identical.
- Consumption is atomic and requires every trusted context field to match.
- Replays, expiration, invalidation, application/guild/principal mismatches, and binding mismatches fail closed.
- Failed Discord acknowledgement invalidates the state.
- Expired, consumed, and invalidated rows are eligible for bounded cleanup.
- State identifiers and binding details are never written to Discord messages or ordinary logs.

The default lifetime is two minutes. `FACTORY_FLOOR_LAUNCH_TTL_MS` accepts values from 30 seconds through 10 minutes.

## Official sources

- [Discord application commands](https://discord.com/developers/docs/interactions/application-commands)
- [Discord interaction response types](https://discord.com/developers/docs/interactions/receiving-and-responding)
- [Discord Activities overview](https://discord.com/developers/docs/activities/overview)
- [discord.js `PrimaryEntryPointCommandInteraction`](https://discord.js.org/docs/packages/discord.js/main/PrimaryEntryPointCommandInteraction:Class)

## Related

- [Factory Floor Activity boundary](../explanation/architecture/factory-floor-activity-boundary.md)
- [Discord capabilities](discord-capabilities.md)
- [Configuration](configuration.md)
- [Enable the Factory Floor Activity](../how-to/integrations/enable-factory-floor-activity.md)

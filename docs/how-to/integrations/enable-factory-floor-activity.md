# Enable the Factory Floor Activity

Use this procedure after the Discord Agent–Factory Floor service-authentication and binding foundation is installed. The Activity launch command is disabled by default and is registered only when the Factory Floor adapter configuration is valid.

## Prerequisites

- The Discord application has Activities enabled in the Discord Developer Portal.
- The application is installed to the configured guild with the `bot` and `applications.commands` scopes.
- Discord Agent can register global application commands.
- `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` identify the application and private server that own the launch context.
- Directional Factory Floor service-authentication keys are configured and distinct.
- The project has an active Discord Agent–Factory Floor project binding. Task-thread launches also require an active surface/run binding.

## Configure the host

Set the required adapter values:

```dotenv
FACTORY_FLOOR_ENABLED=true
FACTORY_FLOOR_BASE_URL=https://factory-floor.example/
FACTORY_FLOOR_AGENT_TO_FACTORY_KEY=replace-with-agent-to-factory-key
FACTORY_FLOOR_FACTORY_TO_AGENT_KEY=replace-with-factory-to-agent-key
```

Optional launch-state lifetime:

```dotenv
FACTORY_FLOOR_LAUNCH_TTL_MS=120000
```

The allowed range is `30000` through `600000` milliseconds. Two minutes is the default.

Do not reuse the Discord bot token, OAuth credentials, operator token, Activity session tokens, or either directional service-authentication key for another credential class.

## Restart Discord Agent

Restart the process after changing environment configuration. Startup performs these actions in order:

1. Open SQLite and apply migrations, including launch-state migration 12.
2. Compose the optional Factory Floor adapter without making a network request.
3. Recover tasks and scheduled loops.
4. Register normal guild commands.
5. Reconcile the one global `factory-floor` Primary Entry Point command.

A successful first registration logs that the Activity Entry Point was created or updated. An exact existing command is left unchanged on later restarts.

## Verify the Discord surface

Open the configured server and use the application launcher from a registered project `#agent` channel or a bound task thread.

Expected behavior:

- A project channel with no active Factory Floor run opens project context.
- A project channel with exactly one active run opens that run.
- A project channel with multiple active runs asks you to open the specific task thread.
- A bound task thread opens its exact active run.
- Unbound, unauthorized, cross-guild, expired, or otherwise mismatched launches fail privately without opening the Activity.

The launch interaction never accepts browser-provided project or run identifiers. Discord Agent persists the trusted server context before acknowledging Discord with `LAUNCH_ACTIVITY`.

## Disable the Activity

Set:

```dotenv
FACTORY_FLOOR_ENABLED=false
```

Restart Discord Agent. It removes the global Primary Entry Point command ID previously adopted by this installation while leaving normal guild commands and direct Claude, Codex, OpenCode, RoboRev, and scheduled-loop behavior unchanged.

## Troubleshooting

- **No Entry Point appears:** confirm Activities are enabled for the application, the bot can register global commands, and adapter configuration is valid.
- **“Project is not connected”:** create or reconcile the Factory Floor project binding.
- **“Open the specific task thread”:** more than one active run exists for the project channel; launch from the intended task thread.
- **Task thread has no active run:** reconcile the Discord surface/run binding before launching.
- **Launch acknowledgement fails:** retry from the same eligible surface. The failed one-time registration is invalidated automatically.

## Related

- [Discord Activity launch registration](../../reference/discord-activity-launch.md)
- [Factory Floor Activity boundary](../../explanation/architecture/factory-floor-activity-boundary.md)
- [Configuration](../../reference/configuration.md)

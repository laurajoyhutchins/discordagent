# Discord Activity OAuth bootstrap

The optional HTTPS broker converts a trusted DA-2 launch into a principal-bound Factory Floor session. It is disabled by default and runs separately from the Discord Gateway.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/discord/activity/oauth/start` | Validate the live instance and register S256 PKCE state |
| `POST` | `/api/v1/discord/activity/bootstrap` | Complete OAuth, consume state once, and create or join the session |

Responses are JSON, `no-store`, bounded, and restricted to exact configured origins.

## Trust boundary

Discord Agent fetches the live Activity instance through Discord's bot-authenticated API and confirms application, `launch_id`, guild, channel, participant, current guild membership, and current authorization. It maps `launch_id` to the DA-2 source interaction.

Bootstrap repeats those checks, verifies the OAuth identity and S256 state, consumes both PKCE and launch state once, then calls the signed DA-1 Factory Floor client. Browser-provided project, run, principal, guild, channel, thread, adapter, installation, and launch identities are ignored.

## Persistence

Migration 13 adds `factory_floor_oauth_attempts`. It stores the launch-state reference, instance ID, S256 challenge and method, and lifecycle timestamps. Sensitive OAuth and session material is not stored in this table or ordinary logs.

## Shared contract

`contracts/discord-activity/bootstrap-v1.json` has SHA-256:

```text
ab0fa633bedc1105db08a019489985083bc0e81a274e5260c25067eff8150ca1
```

## Official sources

- [Discord OAuth2](https://discord.com/developers/docs/topics/oauth2)
- [Embedded App SDK](https://discord.com/developers/docs/developer-tools/embedded-app-sdk)
- [Activity Instance resource](https://discord.com/developers/docs/resources/application#get-application-activity-instance)

## Related

- [Discord Activity launch registration](discord-activity-launch.md)
- [Configuration](configuration.md)
- [Deploy the bootstrap broker](../how-to/integrations/deploy-factory-floor-bootstrap-broker.md)

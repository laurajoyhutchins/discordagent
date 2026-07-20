# Discord Activity mutation revalidation

Factory Floor must revalidate the current Discord principal immediately before executing an Activity approval or cancellation. The optional HTTPS broker exposes one narrow service-to-service endpoint for that decision.

## Endpoint

| Method | Path | Authentication |
|---|---|---|
| `POST` | `/api/v1/discord/activity/revalidate` | Exact-body `ff-to-agent` HMAC in `x-factory-floor-service-auth` |

The endpoint is not a browser route and does not emit CORS headers. Requests use the same directional key IDs, bounded clock skew, nonce replay prevention, constant-time comparison, and current/previous key rotation as the DA-1 service-authentication contract.

## Request

Factory Floor supplies the Activity application and instance, installation and guild, Discord surface, principal, adapter, project, run, and requested action. The only supported actions are `approve` and `cancel`.

The request is evidence to check, not authority to trust. Discord Agent rejects missing fields, unsupported actions, wrong applications, cross-guild installations, other adapters, stale or revoked instances, changed participants, removed members, changed roles, and any project/surface/run mismatch.

## Fresh checks

For every accepted request, Discord Agent:

1. verifies the reverse-direction service signature over the exact request body;
2. consumes the signed nonce and enforces timestamp skew;
3. applies a principal-and-action rate limit;
4. fetches the current Activity instance from Discord;
5. verifies the configured application, guild location, current channel or thread, and participant;
6. resolves the current guild member and evaluates current authorized roles;
7. verifies the local Factory Floor project, Activity-instance surface, and active run bindings.

A Discord timeout, membership lookup failure, or missing binding denies the mutation. No cached launch authorization or browser OAuth identity substitutes for these fresh checks.

## Response

Responses are bounded JSON with `no-store` headers. An allow response includes the action, principal ID, run ID, stable `authorized` reason, and revalidation timestamp. A deny response omits principal and run attribution and returns one stable reason code. It never includes Discord roles, upstream bodies, signatures, nonces, service keys, session tokens, or exception text.

The stable decision vocabulary is frozen in `contracts/discord-activity/revalidation-v1.json`.

## Activity-instance binding

After OAuth bootstrap validates the live Activity instance and current principal, Discord Agent attaches that instance ID to the existing DA-1 run surface before asking Factory Floor to issue a session. Revalidation later requires the same instance, surface, project, and run chain. An instance cannot be moved to another surface, and a surface cannot be rebound to another instance.

## Shared contract

`contracts/discord-activity/revalidation-v1.json` has SHA-256:

```text
9e1d155cfc79f61bc373ada6a35a9157cbe557894fe58fcc7ea0ec193c9395ef
```

Factory Floor must vendor the identical raw bytes and digest test before invoking the endpoint.

## Related

- [Discord Activity OAuth bootstrap](discord-activity-bootstrap.md)
- [Discord Activity launch registration](discord-activity-launch.md)
- [Configuration](configuration.md)
- [Factory Floor Activity trust boundary](../explanation/architecture/factory-floor-activity-boundary.md)

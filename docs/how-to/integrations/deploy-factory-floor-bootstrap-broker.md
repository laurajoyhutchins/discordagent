# Deploy the Factory Floor bootstrap broker

Use this procedure after the Factory Floor adapter and trusted Activity launch are working.

## Prerequisites

- A public HTTPS origin that the embedded Activity can reach.
- A certificate and private-key file readable by the Discord Agent process.
- The exact Activity origin and OAuth callback URL from the Discord application configuration.
- The Discord OAuth application credential stored only on the host.
- A working Factory Floor service-authentication configuration.

## Configure

Set `FACTORY_FLOOR_BROKER_ENABLED=true` and configure the broker variables documented in [Configuration](../../reference/configuration.md). Keep the default loopback host when a local reverse proxy provides the public route; otherwise bind only the required interface.

The public origin and CORS entries must be HTTPS origins without paths. Redirect entries are exact HTTPS callback URLs. The broker rejects unlisted values.

## Start and verify

Restart Discord Agent. A successful startup logs:

```text
[factoryFloor] Activity bootstrap broker started.
```

Launch the Activity from a bound project channel or task thread. Confirm that:

1. OAuth start returns S256 state only from the configured Activity origin.
2. Bootstrap succeeds for the current authorized member.
3. Reusing the same state fails.
4. Removing the member's authorized role prevents a new bootstrap.
5. Direct provider tasks continue if the broker is stopped or misconfigured.

## Disable

Set `FACTORY_FLOOR_BROKER_ENABLED=false` and restart. The global Activity Entry Point remains controlled by `FACTORY_FLOOR_ENABLED`; only the HTTPS bootstrap listener is removed.

## Troubleshooting

- **Broker does not start:** verify TLS file permissions, port availability, and all required environment values.
- **Origin rejected:** compare the browser `Origin` header with the exact configured origin.
- **Redirect rejected:** use the exact callback URL registered for the Discord application.
- **Instance unavailable:** confirm the Activity was launched through the DA-2 Entry Point and is still active.
- **Authorization rejected:** confirm the user is still a guild member with an authorized role.
- **Factory Floor unavailable:** verify the DA-1 service-authentication keys and Factory Floor session endpoint.

## Related

- [Enable the Factory Floor Activity](enable-factory-floor-activity.md)
- [Discord Activity OAuth bootstrap](../../reference/discord-activity-bootstrap.md)
- [Discord Activity launch registration](../../reference/discord-activity-launch.md)

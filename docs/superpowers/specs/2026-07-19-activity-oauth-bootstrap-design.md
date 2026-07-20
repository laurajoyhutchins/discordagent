# Trusted Activity OAuth Bootstrap Broker Design

## Goal

Add the Discord Agent-owned HTTPS bootstrap boundary that turns a DA-2 launch registration into a principal-bound Factory Floor Activity session without trusting browser-selected Discord, project, or run identifiers.

## Architecture

The broker exposes two JSON endpoints under `/api/v1/discord/activity`:

- `POST /oauth/start` accepts only an Activity `instanceId` and an S256 `codeChallenge`. It validates the live instance through Discord's bot-authenticated Activity Instance API, resolves the DA-2 launch by Discord `launch_id`, revalidates the current guild member and authorization policy, records the PKCE challenge, and returns the existing opaque launch state plus the public OAuth parameters required by the Activity client.
- `POST /bootstrap` accepts the returned state, authorization code, code verifier, redirect URI, and instance ID. It revalidates the live instance and current member, verifies PKCE, exchanges the code with Discord using the server-only client secret, confirms `/users/@me` matches the launch principal, atomically consumes the DA-2 state, creates or joins the Factory Floor Activity session through the DA-1 signed service client, and returns only the Discord access token and bounded Factory Floor session material needed by the embedded shell.

The browser never supplies an authoritative guild, channel, thread, project, run, principal, adapter, installation, or launch identifier. Discord's Activity Instance API supplies application, instance, launch, location, and participant assertions. The launch ID is matched to DA-2's source interaction ID.

## Components

- `factoryFloorBootstrapMigration.ts`: append-only migration 13 for PKCE attempts.
- `factoryFloorOAuthRepository.ts`: idempotent challenge registration, verifier consumption, expiry, and cleanup.
- `discordOAuthClient.ts`: bounded Discord token exchange, current-user lookup, and Activity Instance lookup with strict response validation and redacted errors.
- `activityBootstrapService.ts`: pure orchestration and authority checks.
- `activityBootstrapHttp.ts`: strict JSON/CORS/origin/body-size/cache/error boundary.
- `activityBootstrapServer.ts`: optional HTTPS lifecycle with explicit host, port, TLS certificate, key, and allowed-origin configuration.

## Authority and security

- S256 is the only accepted PKCE method.
- OAuth state is the existing random DA-2 launch state and is never logged.
- A PKCE challenge can be registered once per launch; exact retries are idempotent and conflicting challenges fail closed.
- Bootstrap revalidates the Activity instance, launch ID, location, participant, OAuth user, current guild membership, and current role authorization.
- Launch state and PKCE state are consumed once. Replays, expired records, mismatches, retired bindings, or unavailable Discord/Factory Floor dependencies fail closed.
- Client secret, bot token, service-authentication keys, authorization code, verifier, access token, and session token are never persisted in SQLite or included in logs.
- Responses use `Cache-Control: no-store`, exact allow-listed CORS origins, JSON-only content types, bounded bodies, and stable error codes.

## Deployment boundary

The broker is disabled by default. When enabled it requires an HTTPS certificate/key, explicit public origin, exact Activity origins, a Discord client secret, and the existing Discord bot/application/guild plus Factory Floor configuration. Failure to initialize the optional broker is isolated from direct Claude, Codex, OpenCode, RoboRev, scheduled-loop, and Discord gateway operation.

## Verification

- Repository tests for migration 13, PKCE registration/consumption, retry/conflict/expiry/cleanup, and state replay.
- Client tests for token exchange, current-user lookup, instance lookup, timeouts, size limits, malformed responses, and redaction.
- Service tests for application/launch/location/participant/member/role/OAuth-user mismatches and Factory Floor request mapping.
- HTTP tests for origin, CORS, methods, content type, body limit, cache headers, and stable error mapping.
- Shared `contracts/discord-activity/bootstrap-v1.json` bytes and digest verified in Discord Agent and Factory Floor.
- Full repository formatting, source policy, type-check, tests with coverage, build, docs, exact-head CI, and review clearance.

# Factory Floor Activity boundary

A Factory Floor Discord Activity is an operator interface embedded in the Discord Agent experience. It is not another task runtime, event store, or source of durable execution truth.

The authoritative cross-repository design lives in Factory Floor:

- [Discord Activity operator interface](https://github.com/laurajoyhutchins/factory-floor/blob/main/docs/explanation/discord-activity-operator-interface.md)
- [Cross-repository implementation sequence](https://github.com/laurajoyhutchins/factory-floor/issues/33)

This page records only the durable Discord Agent boundary. Active sequencing, dependencies, and delivery status belong in the tracking issue rather than public architecture documentation.

## Authority boundary

Discord Agent owns:

- Discord Entry Point and component interactions;
- channel, thread, project, task, user, guild, and role context;
- trusted launch registration and Activity-instance validation;
- Discord OAuth exchange and current guild-member lookup;
- project/task-to-Factory-Floor adapter bindings;
- Discord-native messages, controls, and presentation state.

Factory Floor remains authoritative for:

- commands and runs;
- deliveries, executions, and attempts;
- artifacts and lineage;
- policy decisions and approvals;
- cancellation;
- durable runtime state and operator queries.

Discord Agent may cache linkage and synchronization metadata, but it must not reconstruct or mirror Factory Floor runtime truth in SQLite.

## Adapter placement

The integration belongs behind a focused `src/factoryFloor/` adapter boundary composed by the existing runtime lifecycle.

It must remain separate from:

- `AgentProvider` implementations;
- provider sessions and worktrees;
- `TaskCoordinator` lifecycle rules;
- primary-agent conversation and memory contracts;
- usage admission and provider selection.

A project without an enabled Factory Floor binding must behave exactly as it does today. Claude, Codex, OpenCode, RoboRev, and direct Discord task controls remain independent of the Activity integration.

The Activity broker may run in the Discord Agent process because it needs the bot connection, current Discord identity, and local project/task mapping. It is still an adapter: Factory Floor remains the application authority behind it.

## Local persistence boundary

The current schema ends at migration 9. Activity work therefore starts at migration 10 or the next unused version when implementation begins.

SQLite may contain only adapter metadata such as:

- enabled project-to-installation bindings;
- task-to-run and optional region bindings;
- short-lived one-time launch registrations;
- digests of short-lived OAuth state;
- Discord message links and rendered-payload digests;
- opaque synchronization cursors;
- bounded service-authentication replay nonces.

SQLite must not contain:

- Discord OAuth access or refresh tokens;
- Factory Floor Activity bearer tokens;
- HMAC keys or signatures;
- Factory Floor events, executions, attempts, artifacts, lineage, policy decisions, or approval state;
- artifact contents or copied runtime projections.

Existing task control cards remain the direct-task projection for Discord Agent's own provider-neutral task runtime. Factory Floor synchronization must use separate bindings and canonical Factory Floor queries rather than treating those cards as shared runtime state.

## Trusted launch and identity

A launch starts from server-resolved Discord context, not browser-supplied identifiers.

The adapter must:

1. authorize the Discord interaction using current bot rules;
2. resolve the current project channel or task thread;
3. resolve an enabled Factory Floor project binding and, when applicable, a verified run binding;
4. create a one-time, short-lived server-side launch registration;
5. respond with Discord's Activity launch interaction;
6. validate the official Activity instance, application, location, connected user, and current guild roles during bootstrap.

Browser query parameters may select presentation inside an already authorized view. They may not establish project, task, run, role, or Activity-instance authority.

OAuth uses authorization-code exchange with S256 PKCE and one-time state. Tokens are returned with `Cache-Control: no-store` and are never persisted by Discord Agent.

## Service authentication and mutation safety

Discord Agent and Factory Floor use separate directional service-authentication keys. Requests are signed over the exact method, path, body digest, timestamp, nonce, key identifier, and protocol version. Verification requires bounded clock skew, constant-time comparison, replay protection, and key-rotation overlap.

Approval and cancellation are sensitive actions. Factory Floor must call Discord Agent's private revalidation boundary immediately before mutation so Discord Agent can re-fetch the active Activity instance, current guild member, location, and required role. Failure or stale identity fails closed.

The browser never supplies trusted role claims. Factory Floor never receives the Discord bot token or broad Discord authority.

## Discord synchronization

Discord messages are a projection, not a source of truth.

Synchronization may store a message link, an opaque cursor, and the digest of the last rendered payload. Events are refresh hints only. Before creating or editing a Discord message, the adapter re-queries canonical Factory Floor state, renders deterministically, and advances its cursor only after successful processing.

After restart or cursor loss, reconciliation is bounded to current linked projects and runs. Runtime event history and artifact bodies are never copied into SQLite.

## Lifecycle and failure behavior

The feature is disabled by default.

When enabled, the runtime starts the broker only after migrations and Discord readiness, and stops HTTP intake and synchronization before closing SQLite. A configured broker that cannot start must fail startup rather than advertise a broken Activity. Synchronization failures may degrade the Discord projection, but they must not mutate or reinterpret Factory Floor state.

Rollout begins with read-only views. Approval and cancellation require a separate feature gate and the reverse principal-revalidation boundary. Production enablement follows credentialed desktop, web, iOS, and Android acceptance and a canary project binding.

## Invariants

- Factory Floor is the sole durable runtime authority.
- Discord Agent is the sole authority for current Discord identity, roles, and launch context.
- No Factory Floor concept enters provider-neutral agent contracts.
- No Discord concept enters Factory Floor runtime-core or authoritative runtime tables.
- Secrets and bearer tokens remain environment-only and are never written to SQLite or Discord.
- Unbound projects and existing direct-task behavior remain unchanged.
- Cross-repository contracts use versioned fixtures and consumer/provider tests before either side enables the feature.

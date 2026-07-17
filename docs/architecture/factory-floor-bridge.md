# Factory Floor Bridge

## Purpose

The Factory Floor bridge lets Discord Agent act as a conversational and interactive operator surface for the durable Factory Floor runtime.

Discord remains responsible for:

- slash commands and authorization by guild role;
- one task thread per Factory Floor run;
- buttons, embeds, and concise status presentation;
- remembering the Discord thread and status-message binding.

Factory Floor remains authoritative for:

- task submission and idempotency;
- command, delivery, execution, and attempt state;
- approvals and attributed decisions;
- scoped cancellation and stale-result fencing;
- events, traces, and artifacts.

The bridge does not turn Factory Floor into another local provider. Existing Claude and Codex tasks continue through `TaskCoordinator`, provider sessions, and isolated local worktrees exactly as before.

## Enablement

The bridge is disabled unless all deployment-specific configuration is intentionally provided:

```dotenv
FACTORY_FLOOR_ENABLED=true
FACTORY_FLOOR_BASE_URL=http://127.0.0.1:3000
FACTORY_FLOOR_OPERATOR_TOKEN=<operator token only>
FACTORY_FLOOR_DEFAULT_REPOSITORY=laurajoyhutchins/factory-floor
```

Never put `CONTROL_PLANE_ADMIN_TOKEN` on the Discord Agent host. The operator token can use Factory Floor's operator namespace and read-only inspection surface, but it cannot apply systems, register runtime definitions, submit arbitrary commands, or rebuild projections.

The control plane should be reachable only over localhost, a private network, or a private authenticated tunnel. TLS is required when crossing an untrusted network.

## Discord commands

`/factory-floor status`
: Reads the current control-plane summary.

`/factory-floor submit`
: Creates a Discord thread, submits a durable development task, stores the returned run ID, and maintains one status card in the thread. The command grants branch and draft-PR authority but explicitly denies merge authority.

`/factory-floor run`
: Refreshes the bound run in the current thread, or a supplied run ID.

`/factory-floor approvals`
: Lists up to five pending approvals with explicit approve and reject buttons.

Status cards provide **Refresh** and, for nonterminal runs, **Cancel run** buttons.

## Durable local binding

Migration 5 adds `factory_floor_runs`. It stores only:

- the canonical Factory Floor run ID;
- the Discord guild, channel, thread, and status-message IDs;
- repository, project label, objective, and requesting Discord user;
- the last projected state, error, and terminal timestamp.

It does not mirror Factory Floor events, execution graphs, approvals, or artifacts.

On startup, the bridge reads every nonterminal binding and asks Factory Floor for its current state. No task is replayed and no completion is inferred from stale local state.

## Polling and restart behavior

Active runs are refreshed every `FACTORY_FLOOR_POLL_INTERVAL_MS`, with a minimum of five seconds. Each refresh edits the existing thread status card. Terminal runs stop appearing in the active query and are no longer polled.

Temporary API or Discord failures are recorded on the local binding and logged without changing the last known Factory Floor state. A later successful refresh clears the error.

## Audit identity

Every API call carries:

```http
X-Factory-Floor-Principal-Id: discord:<user id>
X-Factory-Floor-Adapter: discord-agent
```

Interactive approvals and cancellations use the Discord interaction ID as the Factory Floor client request ID. Equivalent retries are therefore idempotent, while conflicting reuses remain visible as `409 Conflict`.

Background status refreshes use `discord-agent:poller`. Reads are not treated as attributed mutations.

## Current execution boundary

This bridge completes the control and presentation path. A submitted development task will execute only when the Factory Floor deployment has a compatible worker topology for `development.task.requested` and workers capable of performing the requested repository workflow.

Until that worker lane exists, the Discord integration can submit, persist, inspect, approve, and cancel runs, but those runs may remain queued. That is an execution-capability gap, not a Discord integration gap.

## Verification

Before enabling the bridge on the private bot host:

1. start Factory Floor and verify its operator API with the operator token;
2. run `npm run check` in Discord Agent;
3. run `npm run smoke:host` and `npm run smoke:discord`;
4. set `FACTORY_FLOOR_ENABLED=true` and restart the bot;
5. run `/factory-floor status`;
6. submit a harmless task and confirm one thread, one binding row, one status card, restart recovery, refresh, and cancellation.

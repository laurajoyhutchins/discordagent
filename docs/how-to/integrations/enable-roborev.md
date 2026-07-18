# How to enable or disable RoboRev

Connect a registered project to Discord Agent's RoboRev review source so review notifications appear in a private `#roborev` channel.

RoboRev is an optional review integration, not a coding-agent provider.

## Prerequisites

- RoboRev CLI installed and authenticated on the bot host
- `ROBOREV_CLI_PATH` set when the executable is not available as `roborev`
- A registered Git project
- RoboRev repository setup: `.roborev`, `.roborev.json`, or the expected `.git/hooks/post-commit` hook
- The bot's temporary/bootstrap `Manage Channels` permission while creating or deleting the review channel

## Enable during project registration

Pass `roborev:true` when registering the project:

```text
/add-project name:my-project path:/absolute/path/to/repository roborev:true
```

Discord Agent creates the project and its `#roborev` channel, persists the channel association, and notifies the in-process review source to reconcile its active project set.

When the `roborev` option is omitted, Discord Agent enables the integration only when both the CLI and repository configuration are detected.

## Enable for an existing project

Run:

```text
/roborev project:my-project enable:true
```

Discord Agent verifies the CLI and repository setup before it creates or persists anything. On success it:

1. creates `#roborev` beneath the existing project category;
2. stores the channel ID on the project record;
3. signals the RoboRev review source to reconcile immediately.

Expected result: the command identifies the new review channel.

## Disable for an existing project

Run:

```text
/roborev project:my-project enable:false
```

Discord Agent deletes the review channel, clears its persisted channel ID, and reconciles the review source. The registered project, coding-agent tasks, and task history remain unchanged.

## Verify delivery

Trigger a RoboRev review through the repository's normal RoboRev workflow. Confirm that a normalized review message appears in the project's `#roborev` channel.

The source supervises the local CLI stream, parses provider-specific events, normalizes them into review notifications, and publishes them through Discord Agent's authenticated bot connection. It does not create or store Discord webhooks.

## Troubleshooting

| Symptom | Check |
|---|---|
| “RoboRev CLI is not available” | Run the configured executable on the bot host and verify `ROBOREV_CLI_PATH` |
| “Project directory does not have RoboRev configuration” | Add the supported RoboRev config or Git hook to the registered repository |
| Channel creation or deletion fails | Temporarily restore the bot's `Manage Channels` permission and run `/capabilities` |
| Channel exists but reviews do not arrive | Inspect bot logs for CLI startup, stream parsing, project matching, or Discord delivery failures |
| Project already enabled or disabled | The command is intentionally idempotent and reports the existing state |

Discord delivery failures are contained at the publication boundary and do not redefine the review source's lifecycle.

## Related

- [Commands reference: `/roborev`](../../reference/commands.md#roborev)
- [Configuration reference](../../reference/configuration.md)
- [Review-source boundary](../../explanation/architecture/review-source-boundary.md)

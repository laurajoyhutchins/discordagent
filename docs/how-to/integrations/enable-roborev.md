# How to enable Roborev

Integrate automated code review with the Roborev CLI.

## Prerequisites

- [Roborev CLI](https://roborev.ai) installed and authenticated on the bot host
- `ROBOREV_CLI_PATH` configured in `.env` (defaults to `roborev`)
- A registered project with a Git repository

## Configuration

```env
ROBOREV_CLI_PATH=roborev
```

## Procedure

### Enable Roborev during project registration

When running `/add-project`, set the `roborev` option to `true`:

```text
/add-project name:my-project path:/path/to/repo roborev:true
```

The bot creates a `#roborev` channel in the project category and starts the Roborev stream.

### Enable Roborev on an existing project

Use the project settings panel:

```text
/project-settings
```

Toggle the Roborev setting to enabled.

## How it works

When Roborev is enabled:

1. The bot starts `roborev stream` at startup.
2. Events are matched to registered repository paths.
3. Review embeds are sent directly to the project's `#roborev` channel through the authenticated Discord bot client.

**Security note:** Discord Agent does not create, DM, persist, or use Roborev webhook credentials. All Roborev messages are sent through the bot's own Discord connection.

## Verification

- After enabling Roborev, push a change to the project repository.
- Confirm a review embed appears in the `#roborev` channel.
- Check the bot logs for `Roborev stream connected` on startup.

## Troubleshooting

| Problem | Resolution |
|---|---|
| No Roborev channel created | Check `ROBOREV_CLI_PATH` is correct and the CLI is installed |
| Review embeds not appearing | Check the bot logs for Roborev stream connection errors |
| Webhook errors in logs | The bot does not use webhooks; these may be from an earlier configuration |

## Reference

- [Commands reference](../../reference/commands.md)
- [Configuration reference](../../reference/configuration.md)

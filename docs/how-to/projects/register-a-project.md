# How to register a project

Register a local Git repository as a Discord Agent project and create its Discord channels.

## Prerequisites

- The bot is running and connected to Discord
- A provider has been selected in `#agent-chat` (the project inherits the global provider)
- The repository path is accessible from the bot host
- If `PROJECTS_BASE_DIR` is set, the path must be under that directory

## Procedure

1. Ensure the repository is a valid Git repository:

   ```bash
   git -C /absolute/path/to/repo rev-parse --git-dir
   ```

2. In any Discord channel where the bot can see messages, run:

   ```text
   /add-project name:my-project path:/absolute/path/to/my-project
   ```

   The `name` is used for the Discord category. The `path` must be an absolute filesystem path.

3. Optionally enable Roborev by setting the `roborev` option to `true`. If omitted, Roborev is auto-detected.

4. The bot creates:
   - A Discord category named after the project
   - A private `#agent` channel in that category for task creation
   - A `#roborev` channel if Roborev is enabled

## Verification

- The project's `#agent` channel should be visible to authorized roles and contain a welcome message.
- Run `/list-projects` to confirm the project appears with its provider, model, and channel info.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| "Path not under PROJECTS_BASE_DIR" | `PROJECTS_BASE_DIR` is set and the path is outside it |
| "Not a Git repository" | The directory is not a Git repository or `git rev-parse` failed |
| "Missing Manage Channels permission" | The bot lacks the bootstrap permission; see [configure permissions](../discord/configure-permissions-and-intents.md) |
| Bot does not respond to command | Run `/capabilities` to check Discord connectivity |

## Reference

- [Commands reference: `/add-project`](../../reference/commands.md#add-project)
- [Change a project provider](change-a-project-provider.md)
- [Remove a project](remove-a-project.md)

# How to remove a project

Soft-archive a project and delete its Discord channels.

## Prerequisites

- The project is registered
- The bot is running and has `Manage Channels` permission

## Procedure

In any Discord channel, run:

```text
/remove-project name:my-project
```

The bot:

1. Soft-archives the project record (sets `archived_at` in SQLite)
2. Deletes the Discord category and all channels within it (#agent, #roborev)
3. Leaves all historical task records intact in SQLite for referential integrity

## What persists

- The project record remains in SQLite with `archived_at` set.
- All tasks, events, worktrees, and provider sessions for this project are preserved.
- The worktree directories on the filesystem are **not** removed automatically.

## What is removed

- Discord category, #agent channel, #roborev channel
- The project no longer appears in `/list-projects`
- No new tasks can be created in the project

## Restoring an archived project

Archived projects are not automatically restorable through slash commands. To restore, update the project record's `archived_at` column to `NULL` directly in SQLite.

## Reference

- [Commands reference: `/remove-project`](../../reference/commands.md#remove-project)
- [Register a project](register-a-project.md)

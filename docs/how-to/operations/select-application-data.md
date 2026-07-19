# Select the application data directory

Use this procedure when startup or `npm run smoke:host` reports that more than one default application data directory contains state.

## 1. Stop Discord Agent

Stop every development, compiled, or service-manager instance before selecting operational state. Do not run two processes against different copies of the database.

## 2. Inspect the candidate roots

Check these directories under the repository:

```text
data/
src/data/
dist/data/
```

Look for:

- `discordagent.sqlite` and any associated `discordagent.sqlite-wal` or `discordagent.sqlite-shm` files;
- `projects.json` from the legacy project store;
- `discordagent-worktrees/` containing task worktrees.

Do not delete or merge any candidate yet.

## 3. Choose the authoritative database

Identify the database that contains the projects and task history you intend to keep. Discord Agent does not merge divergent databases automatically.

Set an absolute path in `.env`:

```dotenv
DATABASE_PATH=/absolute/path/to/discordagent.sqlite
```

To keep existing managed worktrees in a different directory, also set:

```dotenv
WORKTREES_BASE_DIR=/absolute/path/to/discordagent-worktrees
```

When `WORKTREES_BASE_DIR` is omitted, Discord Agent uses a `discordagent-worktrees` directory beside the selected database.

## 4. Verify the selection

Run:

```bash
npm run smoke:host
```

Confirm that `Application data`, `Database directory`, and `Worktree directory` no longer fail and point to the intended locations.

## 5. Start and inspect

Start Discord Agent in the normal execution mode and verify that expected projects, settings, and task history are present. Keep the unselected directories as backups until the selected installation has been exercised successfully.

A later manual consolidation should be treated as an operational migration: stop the bot, preserve the database and any SQLite sidecar files together, preserve managed worktrees, and retain a backup. Discord Agent intentionally does not perform that move or merge automatically.

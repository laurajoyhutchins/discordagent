# Back up and restore durable state

Use this procedure to create, verify, restore, or roll back Discord Agent's SQLite state. The backup artifact contains durable application data only. Discord tokens, provider credentials, device authentication, Access credentials, arbitrary environment variables, and managed Git worktrees remain outside the artifact boundary.

## Before you begin

Set `DATABASE_PATH` to the authoritative SQLite database and run commands from the same checkout and environment used by the service. Keep backup storage readable only by the service operator.

The commands below use these placeholders:

- `<backup-root>`: a private directory that will contain published artifacts;
- `<artifact-directory>`: one completed backup directory printed by the backup command;
- `<staging-path>`: a temporary SQLite path on the same host as the active database;
- `<schema-version>`: the schema version supported by the binary that will start after restore.

Never copy only `discordagent.sqlite` while the service is running in WAL mode. Use the online backup command.

## Create and verify a backup

The service may remain running while the online backup is created.

```bash
npm run database:backup -- <backup-root>
npm run database:verify -- <artifact-directory>
```

The backup command prints the completed artifact directory. Verification checks path containment, file size, SHA-256, SQLite `quick_check`, and agreement between the manifest and snapshot schema. Treat a nonzero exit as a failed backup. Preserve failed or incomplete artifacts for diagnosis rather than renaming them into a completed artifact.

Copy or synchronize the entire completed artifact directory. Do not separate its manifest from its SQLite snapshot.

## Restore after host loss

1. Install the same or a compatible Discord Agent revision on the replacement host.
2. Restore `.env`, provider authentication, Discord credentials, and any managed worktrees separately. They are intentionally absent from the database artifact.
3. Set `DATABASE_PATH` to the intended active database path.
4. Keep Discord Agent stopped.
5. Verify and stage the artifact without modifying active state:

```bash
npm run database:verify -- <artifact-directory>
npm run database:stage-restore -- <artifact-directory> <staging-path> <schema-version>
```

6. Activate the staged candidate:

```bash
npm run database:activate-restore -- <staging-path> <schema-version>
```

Activation acquires the same localhost instance lock used by the running bot. It fails if Discord Agent is still active. The prior active database is retained as `discordagent.sqlite.rollback` beside the selected database unless an explicit rollback path is passed as the third command argument.

7. Start Discord Agent once. Startup applies any supported migrations and runs recovery once. Nonterminal tasks become interrupted; no provider turn is replayed automatically.
8. Verify projects, settings, task history, events, messages, memories, and usage records before deleting the rollback database or the source artifact.

## Recover from database corruption

1. Stop Discord Agent.
2. Preserve the corrupt database and any `-wal` and `-shm` sidecars for investigation.
3. Select the newest completed artifact that passes `npm run database:verify`.
4. Stage and activate it using the host-loss procedure.
5. Start once and inspect recovered state before resuming interrupted work.

Do not activate an artifact that fails checksum, size, containment, schema, or SQLite integrity validation. The restore path is designed to fail before active state changes.

## Recover from a failed migration or failed first start

Stop the service before taking further action. If activation succeeded but the restored application cannot start safely, preserve logs and the staged artifact, then restore the retained rollback database:

1. Confirm Discord Agent is stopped.
2. Move the failed active database aside for investigation.
3. Move `discordagent.sqlite.rollback` back to the configured `DATABASE_PATH`.
4. Preserve permissions so only the service operator can read or write the database.
5. Start the previously known-good application revision once and verify recovery.

Do not repeatedly start a failing revision against the same database. Each attempt can change migration state and blur the original failure boundary.

## Recover from an interrupted restore

Activation retains the former active database before replacing it and attempts to restore that rollback automatically if activation fails. After an interruption:

1. Keep Discord Agent stopped.
2. Inspect the configured active path, `<staging-path>`, and `discordagent.sqlite.rollback`.
3. Run `npm run database:verify -- <artifact-directory>` again.
4. If the active path is absent and the rollback exists, restore the rollback to `DATABASE_PATH` before starting the service.
5. If the active path exists, validate it independently before starting. Do not infer success from file presence alone.
6. Preserve all ambiguous files until one authoritative database has been selected and exercised.

## Roll back a restored database

Use rollback when the restored database passes artifact validation but produces unacceptable application behavior.

1. Stop Discord Agent.
2. Preserve the current active database as evidence.
3. Restore `discordagent.sqlite.rollback` to `DATABASE_PATH`.
4. Start the application revision that previously owned that database.
5. Verify durable state and recovery before resuming tasks.

A rollback database is not a substitute for a verified backup. Retain at least one completed artifact until the restored host has passed startup and operational checks.

## Retention and automation

Retention code deletes only complete artifacts that still pass verification. Staging, corrupt, and unverifiable artifacts are skipped and reported so evidence is not silently destroyed.

A service-manager timer is optional. Automate only the online backup and verification steps while the service is running. Keep restore staging and activation manual because they are destructive, require an offline instance lock, and must use an explicitly selected artifact and schema boundary.

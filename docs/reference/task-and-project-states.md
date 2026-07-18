# Task and project states

## Task statuses

| Status | Description | Terminal |
|---|---|---|
| `created` | Task record created, provider not yet started | No |
| `starting` | Provider initializing | No |
| `running` | Provider executing | No |
| `waiting_for_user` | Provider awaiting approval or input | No |
| `completed` | Provider reported successful completion | Yes |
| `failed` | Provider reported failure | Yes |
| `cancelled` | Task cancelled by user or system | Yes |
| `interrupted` | Nonterminal task at last startup; not replayed | Yes |

### State transitions

```
created → starting → running → completed
                          ↓
                    waiting_for_user → running (resumed)
                      
starting → failed
running → interrupted  (on restart)
running → cancelled
```

### Persistence

- Task records are stored in the `tasks` SQLite table.
- Each task is associated with exactly one project, one immutable provider, and one Discord thread.
- Settings are snapshotted at task creation in `settings_json`.
- Provider session identity is stored before awaiting completion.

## Project status

Projects have an `archived_at` timestamp:

- **Active** — `archived_at IS NULL`
- **Archived** — `archived_at` is set (soft delete)

Archived projects no longer appear in `/list-projects`, but all task records and worktree data remain in SQLite for referential integrity.

## Worktree state

Worktrees are associated with tasks through the `worktrees` table:

| Column | Description |
|---|---|
| `branch` | Branch name (`agent/<provider>/<slug>-<thread-suffix>`) |
| `worktree_path` | Absolute filesystem path |
| `base_ref` | The base branch or commit used |
| `removed_at` | Null while active; set after removal |

Dirty worktrees are never force-removed by the runtime. Removal sets `removed_at` but does not delete files.

## Provider session identity

| Invariant | Description |
|---|---|
| Per-task uniqueness | One session per durable task |
| Composite uniqueness | `(provider, session_id)` must be unique in `provider_sessions` |
| Immutable provider | Provider identity cannot change within a task |
| Continuation | Must return the same session identity or fail |

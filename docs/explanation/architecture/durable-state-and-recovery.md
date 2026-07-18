# Durable state and recovery

Discord Agent uses SQLite as its authoritative store for all operational state. This provides crash resilience, inspectability, and deterministic recovery.

## What SQLite stores

- Projects, provider-scoped model settings, and reasoning-effort settings
- Tasks and immutable provider identities
- Worktrees and branches
- Provider session identifiers
- Normalized task events and terminal results
- The complete primary-agent conversation journal with FTS5 index
- Durable memory records with revision provenance
- Provider usage snapshots, task-cost observations, and capacity reservations

## Why SQLite?

- **No external database server** — the bot is self-contained
- **Transactional** — task creation, worktree persistence, and session storage are atomic
- **Inspectable** — the database can be queried directly for debugging
- **Portable** — a single file contains all state

## Startup recovery

On startup, the runtime:

1. Opens the database and runs any pending migrations.
2. Detects tasks left in nonterminal states (`created`, `starting`, `running`, `waiting_for_user`).
3. Transitions those tasks to `interrupted`.
4. Inspects the recorded worktree path for each interrupted task.
5. Writes a recovery checkpoint event.
6. Attempts to post a concise recovery message in the original Discord thread.

**No provider turn is replayed automatically.** This is a deliberate safety boundary:

- A provider turn may have had side effects (file changes, commands) before the interruption.
- Replaying automatically could duplicate those side effects or cause new ones.
- The user must explicitly resume by sending a message in the thread.

## Interrupted task semantics

| Property | Behavior |
|---|---|
| Task status | `interrupted` (terminal) |
| Provider session | Retained in SQLite |
| Worktree | Preserved on filesystem |
| Events | Preserved in SQLite |
| Auto-replay | Never |
| Resume | User message in thread creates a continuation |

## Migration safety

Schema migrations are versioned and transactional. Provider-constraint rebuilds temporarily disable SQLite foreign-key enforcement, run `foreign_key_check` before commit, and restore the prior pragma value.

## Related

- [Task isolation and Git worktrees](task-isolation-and-git-worktrees.md)
- [Recover an interrupted task](../../how-to/operations/recover-an-interrupted-task.md)
- [Task and project states reference](../../reference/task-and-project-states.md)

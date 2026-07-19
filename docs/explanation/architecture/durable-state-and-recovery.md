# Durable state and recovery

Discord Agent uses SQLite as its authoritative store for operational state. This provides crash resilience, inspectability, and deterministic recovery.

## What SQLite stores

- Projects, provider-scoped model settings, and reasoning-effort settings
- Tasks and immutable provider identities
- Worktrees and branches
- Provider session identifiers
- Normalized task events and terminal results
- Scheduled-loop identity, prompt, interval, iteration, due time, lifecycle status, and attribution
- The complete primary-agent conversation journal with FTS5 index
- Durable memory records with revision provenance
- Provider usage snapshots, task-cost observations, and capacity reservations

## Why SQLite?

- **No external database server** — the bot is self-contained
- **Transactional** — task creation, worktree persistence, loop transitions, and session storage are atomic
- **Inspectable** — the database can be queried directly for debugging
- **Portable** — a single file contains all state

## Startup recovery

The runtime opens the database and applies pending migrations before accepting Discord work. Task recovery and scheduled-loop reconciliation then run from their durable records.

### Interrupted tasks

For tasks left in nonterminal states (`created`, `starting`, `running`, `waiting_for_user`), the runtime:

1. Transitions the task to `interrupted`.
2. Inspects the recorded worktree path.
3. Writes a recovery checkpoint event.
4. Attempts to post a concise recovery message in the original Discord thread.

**No task provider turn is replayed automatically.** A provider turn may have produced file or command side effects before interruption, so replay could duplicate those effects. The user must explicitly resume by sending a message in the thread.

### Scheduled loops

Scheduled-loop timers are process-local execution machinery; the SQLite loop record is authoritative. On startup:

- A future `next_run_at` is scheduled for its original due time.
- An overdue loop runs once immediately, regardless of how many intervals elapsed, then resumes its normal interval. Discord Agent never creates an unbounded catch-up burst.
- A loop found in `running` state is treated as crash-interrupted. Its already-acquired iteration is not replayed; the next run is deferred by one interval.
- Reconciliation owns at most one timer per active loop, and compare-and-set lifecycle transitions prevent duplicate or overlapping iterations.
- A missing or archived project, deleted thread, or inaccessible Discord surface terminalizes the loop with an operator-readable reason instead of retrying forever.

A clean shutdown detaches timers without stopping durable active loops. The next process reconciles those records using the same policy. Deleting a loop thread or removing its project terminalizes the corresponding loop and prevents future iterations.

## Interrupted task semantics

| Property | Behavior |
|---|---|
| Task status | `interrupted` (terminal) |
| Provider session | Retained in SQLite |
| Worktree | Preserved on filesystem |
| Events | Preserved in SQLite |
| Auto-replay | Never |
| Resume | User message in thread creates a continuation |

## Scheduled-loop lifecycle semantics

| Property | Behavior |
|---|---|
| Active source of truth | SQLite `scheduled_loops` record |
| Timer ownership | Process-local; reconstructed on startup |
| Missed intervals | One immediate run, then normal cadence |
| Crash during iteration | Acquired iteration is not replayed; next run is deferred |
| Stop controls | Idempotent durable transition |
| Thread/project removal | Terminal durable transition |
| Shutdown | Timers detached; active records preserved |

## Migration safety

Schema migrations are versioned and transactional. Provider-constraint rebuilds temporarily disable SQLite foreign-key enforcement, run `foreign_key_check` before commit, and restore the prior pragma value.

## Related

- [Task isolation and Git worktrees](task-isolation-and-git-worktrees.md)
- [Recover an interrupted task](../../how-to/operations/recover-an-interrupted-task.md)
- [Task and project states reference](../../reference/task-and-project-states.md)

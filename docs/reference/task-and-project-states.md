# Task and project states

## Task statuses

| Status | Description | Turn active |
|---|---|---:|
| `created` | Durable task and worktree records exist; provider startup has not begun | No |
| `starting` | Provider availability, session startup, or continuation startup is in progress | Yes |
| `running` | Provider is executing the current turn | Yes |
| `waiting_for_user` | Provider is waiting for an approval or answer | Yes |
| `completed` | The most recent turn completed successfully | No |
| `failed` | The most recent turn failed | No |
| `cancelled` | The task was cancelled | No |
| `interrupted` | The bot restarted while the task was nonterminal; no provider turn was replayed | No |

`completed`, `failed`, `cancelled`, and `interrupted` are terminal outcomes for the current turn. A valid continuation may reopen a task that still has its provider session and active worktree. An interrupted task can also be explicitly resumed, transitioning back through `starting`.

## Legal transitions

```text
created ───────────────→ starting ───────────────→ running ───────────────→ completed
  │                         │                       │  ↑
  └────────────────────────→ cancelled             │  └── waiting_for_user
                            │                       │
                            ├──→ failed             ├──→ failed
                            ├──→ cancelled          ├──→ cancelled
                            └──→ interrupted        └──→ interrupted

waiting_for_user ──→ running | completed | failed | cancelled | interrupted
interrupted ───────→ starting | cancelled
```

The repository enforces transitions with compare-and-set semantics. A stale or illegal transition fails instead of silently overwriting newer state.

## Persistence invariants

- Task records are stored in SQLite.
- Each task belongs to one project and one Discord thread.
- The provider is immutable within a durable task.
- Provider-scoped task settings are snapshotted durably.
- Provider session identity is stored before Discord Agent awaits turn completion.
- A continuation must return the same provider session identity.

## Project state

Projects use an `archived_at` timestamp:

- **Active:** `archived_at IS NULL`
- **Archived:** `archived_at` contains the archive time

Archived projects no longer appear in `/list-projects`, and their Discord channels have normally been deleted by `/remove-project`. Historical tasks, events, results, sessions, and worktree records remain in SQLite.

## Worktree records

Each task has one recorded worktree:

| Field | Description |
|---|---|
| `repository_path` | Original registered Git repository |
| `worktree_path` | Absolute path to the isolated task worktree |
| `branch_name` | Task branch, normally `agent/<provider>/<slug>-<thread-suffix>` |
| `base_ref` | Branch or commit from which the worktree was created |
| `removed_at` | Absent while the recorded worktree is active; set after managed cleanup succeeds |

Project removal does not remove task worktrees. When an explicit managed cleanup is performed, Discord Agent first refuses paths outside its managed worktree directory and refuses dirty worktrees. A successful cleanup uses `git worktree remove`; the corresponding record can then be marked removed.

## Provider session identity

| Invariant | Description |
|---|---|
| One session per durable task | A task attaches one provider session identity |
| Composite uniqueness | `(provider, session_id)` is unique in `provider_sessions` |
| Immutable provider | The provider cannot change inside the task |
| Continuation identity | A continuation returning a different session ID fails |
| Provider change | A confirmed sibling handoff creates a separate task and provider session |

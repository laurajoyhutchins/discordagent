# Task isolation and Git worktrees

Every Git-backed task runs on its own branch in an isolated worktree. This is a core safety mechanism.

## Why worktrees?

Git worktrees provide filesystem-level isolation without cloning the full repository:

- Each worktree is a separate working directory with its own index and HEAD.
- Changes in one worktree do not affect others or the primary checkout.
- The branch naming convention makes provider and task provenance clear.
- Dirty worktrees are never force-removed, so in-progress work is never lost.

## Branch naming

```
agent/<provider>/<slug>-<thread-suffix>
```

- `provider` — `claude`, `codex`, or `opencode`
- `slug` — derived from the task objective
- `thread-suffix` — last few characters of the Discord thread ID

This naming convention provides:
- Clear provenance (which provider created the branch)
- Traceability to the Discord thread
- Uniqueness across providers and tasks

## Base branch resolution

When creating a worktree, the base branch is resolved in this order:

1. **Project's explicitly configured base branch** — set via `/project-settings` or `base_branch` in the project record
2. **Symbolic remote default** — e.g., `origin/main` or `origin/master`
3. **Current local branch** — whatever HEAD points to on the bot host

This ensures worktrees are created against a predictable base regardless of the bot host's current checkout state.

## Safety guarantees

- **No force flags** — `WorktreeManager` never adds `--force` to worktree removal, branch deletion, reset, or checkout.
- **Dirty worktree preservation** — Worktrees with uncommitted changes are never removed. The runtime rejects unsafe cleanup.
- **Removal scoping** — Only worktrees within the managed base directory can be removed by the runtime.
- **Transactional creation** — Worktree creation, branch creation, and task persistence happen in coordination. If worktree creation fails, the task is not persisted.
- **Base ref recording** — The base branch or commit is recorded in the `worktrees` table so the worktree's origin is always known.

## Worktree lifecycle

1. **Created** — when the task starts, before provider initialization
2. **Active** — for the duration of the task and any continuations
3. **Preserved** — after task completion, failure, cancellation, or interruption
4. **Removed** — only through explicit cleanup; dirty worktrees are never force-removed

## Related

- [Durable state and recovery](durable-state-and-recovery.md)
- [Filesystem layout reference](../../reference/filesystem-layout.md)
- [Task and project states reference](../../reference/task-and-project-states.md)

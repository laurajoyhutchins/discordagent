# Execution backends

Every durable task records one immutable execution backend.

| Backend | Meaning | Authority |
|---|---|---|
| `local_provider` | Discord Agent starts the provider, owns the provider session and local worktree, persists local events and results, and marks nonterminal work interrupted after restart | Compatibility execution runtime in Discord Agent |
| `factory_floor` | Reserved for an explicit Factory Floor-backed task projection contract | Factory Floor execution authority; not accepted by the local worktree creation path |

Migration 14 classifies every prior task as `local_provider`. This records historical truth. It does not migrate work into Factory Floor.

## Invariants

- One task has one backend for its entire lifetime.
- The local worktree creation path accepts only `local_provider`.
- Provider sessions and local continuation belong only to `local_provider` tasks.
- A provider handoff creates a sibling task.
- A future backend handoff must create a distinct task or explicit mapping with independently meaningful identifiers.
- No unavailable Factory Floor operation may silently fall back to local execution.
- Discord messages and rendered cards are projections, not execution records.

The `factory_floor` value reserves a durable vocabulary. Creating Factory Floor-backed coding tasks still requires the versioned submission, idempotency, identity, cancellation, event, continuation, and recovery contracts described in the [execution authority explanation](../explanation/architecture/execution-authority.md).

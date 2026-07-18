# How to recover an interrupted task

Resume a task that was interrupted by a bot restart or crash.

## Prerequisites

- The bot has been restarted and is running
- The interrupted task thread still exists in Discord
- The task's worktree directory still exists on the filesystem

## Background

When the bot starts, it marks any task in a nonterminal state (`created`, `starting`, `running`, `waiting_for_user`) as `interrupted`. The bot:

1. Inspects the recorded worktree path from SQLite
2. Writes a checkpoint event
3. Attempts to post a concise recovery message in the original thread

**No provider turn is automatically replayed.** This is a deliberate safety boundary — a provider turn may have had side effects before the interruption.

## Procedure

1. Open the interrupted task's Discord thread.
2. Read the recovery checkpoint posted by the bot. It shows:
   - The task objective
   - The provider and session that were active
   - The branch and worktree path
   - The last recorded event status
3. Send a message in the thread to resume work. The task coordinator:
   - Opens a continuation using the same provider, session, branch, and worktree
   - The provider picks up from its own internal persisted state

## If the worktree is missing

If the worktree directory was deleted manually, the task record persists but cannot be continued. The thread should be closed (no `/close` command exists; simply archive the thread manually). Start a new task.

## Prevention

- Run the bot as a service with automatic restart (e.g., systemd, PM2) to minimize interruptions
- Monitor the bot process and restart promptly to reduce the window for concurrent state confusion
- Do not manually delete task worktrees

## Reference

- [Durable state and recovery explanation](../../explanation/architecture/durable-state-and-recovery.md)
- [Trust model explanation](../../explanation/security/trust-model.md)

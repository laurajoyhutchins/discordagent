# Using Task Control Cards

Each task thread has a pinned control card at the top that shows the current state at a glance and exposes task-scoped actions.

## What the control card shows

| Field | Description |
|---|---|
| Objective | The original task prompt |
| Project | Project name |
| Provider | Active provider (Claude, Codex, or OpenCode) |
| Model | Resolved model identifier |
| Status | Current task state |
| Branch | Git worktree branch name |
| Session | Provider session state |
| Phase | Current execution phase |
| Usage posture | Capacity pressure indicator |

## Controls

- **Inspect** returns the current task, result, and branch details privately. It does not expose internal task or provider-session IDs.
- **Cancel** is shown only while the task is active. It delegates to the same provider-neutral coordinator used by `/cancel`, preserving the task record and worktree.

Controls are resolved from the current Discord thread. A copied or stale control outside its task thread fails closed without mutating a task.

## Card lifecycle

1. **Created** — card appears when the task thread is created, before the provider starts
2. **Starting** — provider is initializing
3. **Running** — provider is executing; phase updates as work progresses
4. **Waiting for user** — provider awaits approval or input
5. **Resumed** — provider continues after user interaction
6. **Completed / Failed / Cancelled** — terminal state with result summary; Inspect remains available and Cancel is removed

## Pin state

If the bot has `Pin Messages` permission, the control card is pinned automatically. If pinning fails (for example, Discord is transiently unavailable), it retries once. Persistent failures are recorded to avoid noisy retries.

If the bot lacks `Pin Messages` permission, the card remains unpinned. Run `/capabilities` to check.

## Embed fallback

If the bot lacks `Embed Links`, the control card renders as plain text instead of a rich embed. The task details and action buttons remain available.

## After restart

If the bot restarts while a task is running, the control card is reconstructed from the persisted message. A recovery checkpoint is posted below the card. No provider turn is replayed automatically.
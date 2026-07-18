# Using Task Control Cards

Each task thread has a pinned control card at the top that shows the current state at a glance.

## What the control card shows

| Field | Description |
|---|---|
| Objective | The original task prompt |
| Project | Project name |
| Provider | Active provider (Claude or Codex) |
| Model | Resolved model identifier |
| Status | Current task state |
| Branch | Git worktree branch name |
| Session | Provider session state |
| Phase | Current execution phase |
| Usage posture | Capacity pressure indicator |

## Card lifecycle

1. **Created** — card appears when the task thread is created, before the provider starts
2. **Starting** — provider is initializing
3. **Running** — provider is executing; phase updates as work progresses
4. **Waiting for user** — provider awaits approval or input
5. **Resumed** — provider continues after user interaction
6. **Completed / Failed / Cancelled** — terminal state with result summary

## Pin state

If the bot has `Pin Messages` permission, the control card is pinned automatically. If pinning fails (e.g., Discord is transiently unavailable), it retries once. Persistent failures are recorded to avoid noisy retries.

If the bot lacks `Pin Messages` permission, the card remains unpinned. Run `/capabilities` to check.

## Embed fallback

If the bot lacks `Embed Links`, the control card renders as plain text instead of a rich embed. All information is preserved.

## After restart

If the bot restarts while a task is running, the control card is reconstructed from the persisted message. A recovery checkpoint is posted below the card.

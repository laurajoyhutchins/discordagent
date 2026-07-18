# Usage admission

Provider capacity is managed through a quiet, calibrated admission system. The goal is to avoid overwhelming provider rate limits while keeping routine operation transparent.

## How it works

### Provider windows

Provider usage and rate-limit windows are stored as snapshots in SQLite (`usage_snapshots`). Each snapshot records the state of the provider's rate limits at a point in time.

### Task cost estimation

Each task class has a low and high estimate calibrated from completed observations (`usage_observations`). When a new task is proposed, its estimated cost is compared against available capacity.

### Capacity reservations

Before a task starts, the estimated capacity is reserved (`usage_reservations`). The reservation is attached to the task record and consumed when the task completes. This prevents over-admission when multiple tasks could run concurrently.

### Active holds

Active reservations are included when computing safe capacity. A configurable reserve (`PRIMARY_USAGE_RESERVE`, default 10%) is preserved for primary-agent coordination and recovery.

## Operating postures

| Posture | Description |
|---|---|
| `unknown` | No usage data yet |
| `healthy` | Normal operation |
| `cautious` | Elevated usage; new tasks may be constrained |
| `restricted` | Limited capacity; only essential work admitted |
| `preserve` | Only PM coordination and recovery admitted |
| `exhausted` | No usable capacity |

## Quiet operation

Routine messages hide telemetry. Usage details are surfaced only when:

- A task is unusually expensive
- A task cannot be completed reliably
- A task should be narrowed or deferred
- Provider capacity is critical
- The user explicitly asks via `/usage` or `/agents`

## Preserve-mode interruption

When capacity is critical and a running turn must be checkpointed, the coordinator records a checkpoint and interrupts the provider. This happens at most once per turn. The task state, provider session, branch, and worktree remain available for later continuation.

## Related

- [Provider-neutral runtime](provider-neutral-runtime.md)
- [Configuration reference](../../reference/configuration.md)

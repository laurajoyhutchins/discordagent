# Review-source boundary

RoboRev is a source of code-review notifications, not an agent provider and not part of the durable task-execution contract.

Discord Agent keeps that distinction explicit through the small `ReviewSource` boundary in `src/integrations/reviewSource.ts`:

```ts
interface ReviewSource {
  readonly id: string;
  start(
    publish: (notification: ReviewNotification) => Promise<void>,
  ): Promise<Disposable>;
}
```

A review source owns how an external review system is started, supervised, parsed, and stopped. The application owns where normalized notifications are published.

## Why this boundary exists

The previous RoboRev watcher combined several concerns:

- executing and supervising a specific CLI;
- parsing provider-specific stream events;
- matching events to registered projects;
- rendering Discord messages;
- managing lifecycle and shutdown.

Keeping all of that inside a general runtime service made RoboRev look more fundamental to Discord Agent than it is. The review-source boundary isolates the integration without introducing a speculative plugin framework.

## Current RoboRev adapter

The implementation under `src/integrations/roborev/` owns:

- CLI availability checks and process startup;
- repository setup detection;
- stream supervision and restart behavior;
- event parsing and normalization;
- project matching;
- Discord-oriented review rendering;
- reconciliation when a project's RoboRev channel is enabled, disabled, or removed.

It emits normalized `ReviewNotification` values through the callback supplied to `ReviewSource.start`.

`src/index.ts` constructs the source and wires that callback to Discord delivery. Delivery failures are contained at the publication boundary so they do not redefine or terminate the source lifecycle.

## Why RoboRev remains in-process

RoboRev currently remains an in-process adapter because:

- a sidecar or webhook would add operational complexity without improving the current trust model;
- no second review source exists yet;
- the narrow source contract already prevents CLI-specific logic from spreading through the task runtime;
- a generic integration registry or durable integration store would be speculative until another implementation needs it.

A future review source can implement the same lifecycle contract. A broader registry should be introduced only when concrete implementations demonstrate shared requirements.

## Boundaries that must remain intact

- Review sources do not implement `AgentProvider` and cannot be selected with `/provider`.
- Review notifications do not become task events or provider-session state.
- RoboRev does not receive task worktrees, provider credentials, or primary-agent authority.
- Discord Agent publishes through its authenticated bot connection; it does not create, store, or depend on RoboRev webhook credentials.
- `/roborev` changes project review-channel configuration and triggers source reconciliation; it does not restart or mutate coding-agent tasks.

## Related documentation

- [Enable or disable RoboRev](../../how-to/integrations/enable-roborev.md)
- [Commands reference](../../reference/commands.md#roborev)
- [Provider-neutral runtime](provider-neutral-runtime.md)

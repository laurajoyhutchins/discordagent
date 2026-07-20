# Runtime lifecycle and composition

`startRuntime` is the process composition root. It constructs durable repositories and runtime services, then delegates bounded startup work to explicit lifecycle components. `stopRuntime` does not reproduce shutdown logic; it asks the same lifecycle stack used by startup-failure handling to tear the runtime down.

## Startup phases

The phases run in this order:

1. **Project store and repositories** — opens SQLite and constructs repository adapters.
2. **Renderer and worktree infrastructure** — creates the renderer factory and worktree manager.
3. **Provider bootstrap** — discovers Claude and OpenCode, and owns the Codex provider/auth/transport chain.
4. **Coordinator and registries** — constructs the task coordinator and installs process-local service registries.
5. **Primary-agent bootstrap** — reconciles the primary channel or creates the headless conversation service, selects the active PM provider, and creates provider onboarding when needed.
6. **Usage monitoring** — subscribes to Codex rate-limit updates and optionally starts polling.
7. **Recovery rendering** — recovers interrupted tasks, releases stale usage reservations, and reconstructs Discord recovery checkpoints.

Each component returns a `stop()` contract. The composition root adds that contract to `RuntimeLifecycle` only after the component starts successfully. A later failure therefore tears down every previously acquired phase in reverse order.

## Resource ownership

A closeable resource has one lifecycle owner:

| Resource | Owner |
| --- | --- |
| SQLite project store | Runtime composition root |
| Active task renderers | Runtime composition root |
| Codex provider listeners and active turns | Provider bootstrap |
| Codex authentication listeners and login timer | Provider bootstrap |
| Codex app-server process transport | Provider bootstrap |
| Task coordinator | Runtime composition root |
| Process-local service registries | Runtime composition root |
| Primary-agent service registry | Primary-agent bootstrap |
| Codex usage subscription and polling timer | Usage monitoring |
| Recovery rendering phase | Recovery component |

Injected Codex provider, authentication, and transport objects are transferred to the provider bootstrap for the lifetime of the runtime, matching the ownership behavior of host-created objects. They are each closed at most once.

## Teardown behavior

`RuntimeLifecycle` records cleanup callbacks in acquisition order and runs them once in reverse order. Calling `stopRuntime` more than once awaits the same teardown operation. A cleanup failure is logged with its owner, but teardown continues so one broken resource cannot leak everything acquired before it.

The same stack handles:

- normal process shutdown;
- startup failure after provider bootstrap;
- startup failure during primary-agent setup;
- startup failure during usage setup;
- startup failure during recovery.

## Test seams

`RuntimeOptions.components` may replace the provider, primary-agent, usage, or recovery component factory. Headless smoke tests and lifecycle regression tests can therefore inject a failing phase and assert that every previously returned `stop()` contract runs once in reverse order without requiring a Discord gateway or real provider process.

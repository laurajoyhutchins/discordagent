# How to configure OpenCode

Set up the OpenCode ACP provider for task execution and primary-agent chat.

## Prerequisites

- [OpenCode CLI](https://opencode.ai) installed on the bot host with ACP support
- The `opencode` command available in PATH, or `OPENCODE_CLI_PATH` set to the executable path

## Configuration

```env
OPENCODE_ENABLED=true
OPENCODE_CLI_PATH=opencode
OPENCODE_TIMEOUT_MS=900000
# Optional model overrides:
OPENCODE_MODEL=
OPENCODE_PRIMARY_MODEL=
```

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_ENABLED` | `true` | Set to `false` to disable OpenCode |
| `OPENCODE_CLI_PATH` | `opencode` | Path to the OpenCode CLI executable |
| `OPENCODE_TIMEOUT_MS` | `900000` | Maximum OpenCode turn timeout |
| `OPENCODE_MODEL` | provider default | Default model for OpenCode tasks |
| `OPENCODE_PRIMARY_MODEL` | global/provider default | OpenCode-specific model for the restricted PM chat |

## Verification

1. Start the bot.
2. In `#agent-chat`, OpenCode should be listed as an available provider option.
3. Select OpenCode and send a test task.
4. Confirm the task thread shows OpenCode as the provider and output streams correctly.

## Behavior notes

- OpenCode runs through the local ACP CLI using the Agent Client Protocol v1.
- The task session identity is persisted before awaiting completion. Continuations load or resume that same session when the ACP capability permits it.
- OpenCode has no filesystem or terminal callbacks supplied by Discord Agent and never receives automatic approval.
- The OpenCode primary model runs a separate one-turn ACP process for each PM response with a dedicated deny-all agent, disabled tools, cancelled ACP permission requests, and a disposable empty workspace.

## Failure cases

| Problem | Resolution |
|---|---|
| OpenCode not available | Check `OPENCODE_ENABLED=true` and the CLI passes ACP availability probe |
| "ACP availability probe failed" | Ensure the OpenCode CLI supports the `acp` subcommand |
| Provider switch fails | OpenCode requires sibling handoff; see [change a project provider](../projects/change-a-project-provider.md) |

## Reference

- [Provider support reference](../../reference/provider-support.md)
- [Configuration reference](../../reference/configuration.md)
- [Primary agent boundary](../../explanation/architecture/primary-agent-boundary.md)

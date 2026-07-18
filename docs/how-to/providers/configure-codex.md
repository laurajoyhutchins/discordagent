# How to configure Codex

Set up the Codex provider for task execution and primary-agent chat.

## Prerequisites

- [Codex CLI](https://codex.ai) installed on the bot host
- The `codex` command available in PATH, or `CODEX_CLI_PATH` set to the executable path

## Configuration

```env
CODEX_ENABLED=true
CODEX_CLI_PATH=codex
# Optional model override:
CODEX_MODEL=
```

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_ENABLED` | `true` | Set to `false` to disable Codex |
| `CODEX_CLI_PATH` | `codex` | Path to the Codex CLI executable |
| `CODEX_MODEL` | provider default | Default model for Codex tasks |

### Authentication

Codex authentication is host-local and device-code based.

1. Start the bot and open `#agent-chat`.
2. Run `/codex-auth login` to start the in-memory authentication flow. The bot posts instructions for the host machine.
3. On the bot host, run:

   ```bash
   codex login --device-auth
   ```

4. Complete the browser flow on the host machine.
5. In Discord, click **Check again**. If authentication succeeded, click **Start task**.

Important security rules:

- The verification URL and one-time code are never displayed in Discord or stored in SQLite.
- Login state is memory-only, expires after 30 minutes if not completed, and is cleared on completion, cancellation, logout, or shutdown.
- API keys and secret tool inputs are never requested through Discord.

### Verifying provider status

Use `/codex-auth status` to check current authentication state.

## Failure cases

| Problem | Resolution |
|---|---|
| Codex not available in provider selection | Check `CODEX_ENABLED=true` and the CLI is found at startup |
| "Codex App Server unavailable" | Ensure Codex CLI is installed and authenticated |
| Authentication fails repeatedly | Run `codex login --device-auth` again, ensure you complete the browser flow |
| Login request held for 30 minutes | Complete the auth or cancel with `/codex-auth logout` |

## Reference

- [Provider support reference](../../reference/provider-support.md)
- [Configuration reference](../../reference/configuration.md)
- [Authentication boundaries](../../explanation/security/authentication-boundaries.md)

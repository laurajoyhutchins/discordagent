# Trust model

Discord Agent is designed for a private Discord server with trusted users and repositories. The security model assumes the bot host is under the operator's control and Discord members are authenticated through role-based authorization.

## Authorization layers

### Discord role authorization

Every command and message that creates or modifies state is checked against `AUTHORIZED_ROLE_IDS`. Members without a matching role cannot:

- Register or remove projects
- Change provider or model settings
- Cancel tasks
- Access `#agent-chat` for the primary agent

### Owner-only commands

`/settings` and `/codex-auth` are restricted to the exact owner identified by `AUTHORIZED_USER_ID`. This prevents unauthorized changes to global provider configuration and authentication state.

### Channel access

Project channels and task threads inherit Discord's native permission model. Only members with access to the server and the relevant roles can see project output or participate in task threads.

## Host security assumptions

- The bot host is trusted and under the operator's control.
- Provider credentials and API keys live on the host, not in Discord or SQLite.
- Git commands use argument arrays with `shell: false` to prevent shell injection.
- The host filesystem is accessible only to the bot process and the operator.

## Provider output trust

Provider output is treated as untrusted. All provider events, error messages, and log data pass through the redaction boundary before reaching Discord or SQLite.

## Provider authentication

- **Claude** — Uses the host's existing Claude OAuth session. No credentials enter Discord Agent's code or storage.
- **Codex** — Device-code authentication is host-local. The verification URL and one-time code are never sent to Discord. Login state is memory-only, expires after 30 minutes, and is cleared on completion, cancellation, logout, or shutdown.
- **OpenCode** — Uses CLI-native authentication. Discord Agent does not participate in the auth flow.

## Recovery trust

Interrupted work is never auto-replayed. A possibly side-effecting provider turn must be explicitly resumed by a user message. Dirty worktrees are never force-removed.

## Related

- [Authentication boundaries](authentication-boundaries.md)
- [Secret handling and redaction](secret-handling-and-redaction.md)
- [Primary agent boundary](../architecture/primary-agent-boundary.md)

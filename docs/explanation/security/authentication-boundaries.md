# Authentication boundaries

The system maintains strict boundaries between host-side authentication and Discord-side interaction.

## Principle

Provider authentication credentials, API keys, device codes, and session secrets stay on the bot host. They are never stored in SQLite, sent to Discord, or exposed through the Discord interface.

## Codex authentication flow

Codex uses device-code authentication through an in-memory flow:

1. The user runs `/codex-auth login` in `#agent-chat`.
2. The bot starts a pending authentication flow in memory (not in SQLite).
3. Instructions are posted: run `codex login --device-auth` on the bot host.
4. The user completes the browser flow on the host machine.
5. Back in Discord, the user clicks **Check again**.
6. The bot performs a fresh account read.
7. If authenticated, the user clicks **Start task** to proceed.

Security properties:

- The device URL and one-time code are never shown in Discord.
- Login details are memory-only, never persisted to SQLite.
- Authentication state expires after 30 minutes if not completed.
- State is cleared on completion, cancellation, logout, or shutdown.
- The original pending request does not create a thread or worktree until **Start task** is clicked.

## Provider onboarding

Provider selection in `#agent-chat` verifies:

1. The clicking user is the configured owner (`AUTHORIZED_USER_ID`).
2. The interaction comes from the correct channel (`#agent-chat`).
3. The bot message is the current setup prompt.
4. The message author is the bot itself.

Stale or forged interactions are rejected.

## What never reaches Discord

- Discord bot tokens
- Provider API keys and credentials
- Device verification URLs and one-time codes
- Roborev webhook tokens
- SQLite database contents
- Absolute filesystem paths beyond what the user intentionally shares

## What never reaches SQLite

- Discord bot tokens
- Provider credentials, API keys, or session secrets
- Device codes or verification URLs
- Roborev webhook IDs or tokens

## Related

- [Trust model](trust-model.md)
- [Secret handling and redaction](secret-handling-and-redaction.md)
- [How to configure Codex](../../how-to/providers/configure-codex.md)

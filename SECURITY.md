# Security Policy

## Supported versions

Discord Agent is in active development. Only the latest commit on the `main` branch receives security updates.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/laurajoyhutchins/discordagent/security/advisories/new). Do not post security issues publicly.

## Trust assumptions

- Discord Agent is designed for a private Discord server with trusted users.
- The bot host is under the operator's control and is trusted.
- Discord members are authenticated through role-based authorization (`AUTHORIZED_ROLE_IDS`).
- Provider credentials, API keys, and device codes live on the host and are never sent to Discord or stored in SQLite.

## Security boundaries

| Boundary | Protection |
|---|---|
| Discord commands | Checked against `AUTHORIZED_ROLE_IDS` for every state-changing command |
| Owner-only commands | `AUTHORIZED_USER_ID` exact match for `/settings`, `/codex-auth` |
| Project paths | `PROJECTS_BASE_DIR` restricts which directories can be registered |
| Git commands | Argument arrays with `shell: false` |
| Provider credentials | Never stored in SQLite; redacted from events and logs |
| Provider output | Treated as untrusted; redacted before storage and rendering |
| Primary agent | No repository tools; cannot bypass `TaskCoordinator` |
| Interrupted tasks | Never auto-replayed; requires explicit user message to resume |
| Dirty worktrees | Never force-removed |

## Secret handling

- Discord tokens, provider keys, device codes, and Roborev webhook tokens are never stored in SQLite.
- All provider output passes through the redaction engine (`src/utils/redaction.ts`) before SQLite, Discord, or logs.
- `.env` is excluded from version control and must never be committed.
- Rotate any credential immediately if it is ever committed, even if the commit is later removed.

## Sensitive SQLite contents

The SQLite database contains task objectives, event payloads, provider session identifiers, and conversation history. It does **not** contain:
- Discord bot tokens
- Provider API keys or credentials
- Device codes or verification URLs
- Roborev webhook tokens

Protect the database file with filesystem permissions appropriate for the sensitivity of the task content.

## Host security recommendations

- Run the bot as a dedicated, unprivileged user.
- Use filesystem permissions to restrict access to `.env`, the SQLite database, and worktree directories.
- Keep the host operating system and Node.js version updated.
- Run the bot behind a firewall; it does not need to accept incoming connections beyond the local loopback instance lock.

## What should never be posted to Discord or committed

- Discord bot tokens
- Provider API keys, session secrets, or credentials
- Device verification URLs or one-time codes
- Roborev webhook tokens
- `.env` file contents
- SQLite database files
- Provider login state files
- User-specific absolute paths in examples
- Task transcripts containing sensitive information

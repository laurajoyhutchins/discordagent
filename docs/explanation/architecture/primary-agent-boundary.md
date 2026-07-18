# Primary agent boundary

The primary agent is a project owner and project manager, not a hidden coding session. This is a deliberate design constraint.

## What the primary agent can do

- Converse naturally in `#agent-chat`
- Retrieve relevant history from the SQLite journal (FTS5) and memory system
- Propose bounded work and gather decisions through text, buttons, menus, or polls
- Delegate approved coding tasks to `TaskCoordinator` for execution in provider-fixed threads
- Write provenance-controlled memory records
- Summarize outcomes at a project-owner level

## What the primary agent cannot do

- Edit repositories or make file changes
- Call project MCP tools
- Access provider sessions, worktrees, or project MCP configuration
- Bypass `TaskCoordinator` to start or cancel tasks
- Acquire coding tools through conversation

## Why tool isolation?

A PM-style agent with coding tools would be an unbounded security and reliability risk:

- **Security** — A coding PM with file access could circumvent provider approval policies and role-based authorization.
- **Reliability** — A long-running PM session with tools would compete with task providers for provider capacity and Discord rate limits.
- **Clarity** — Separating planning (PM) from execution (task providers) keeps responsibility boundaries clear. The PM delegates; providers execute.

## Provider-specific PM enforcement

Each provider enforces the tool-isolated boundary differently:

| Provider | PM enforcement |
|---|---|
| Claude | SDK tool options disable all tools for the PM turn |
| Codex | Read-only, network-disabled App Server turn |
| OpenCode | Dedicated ACP primary agent with `deny` permissions, all tools disabled, plugins/snapshots/auto-update off, disposable empty workspace |

Conversation continuity belongs to Discord Agent's SQLite journal, retrieval, and memory system rather than a privileged provider coding session.

## Related

- [Provider-neutral runtime](provider-neutral-runtime.md)
- [Trust model](../security/trust-model.md)

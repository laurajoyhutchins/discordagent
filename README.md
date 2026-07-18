# Discord Agent

Run local coding agents from a private Discord workspace.

Discord Agent provides a persistent PM-style primary agent, isolated task threads, durable provider sessions, and safe Git worktrees across Claude, Codex, and OpenCode.

**Status:** Active development. Breaking changes may occur. The project is derived from [DiscordClaude](https://github.com/NicolaiLolansen/DiscordClaude) (MIT).

## What it does

Discord Agent turns a private Discord server into a secure orchestration surface for AI coding agents. A PM-style primary agent in `#agent-chat` discusses priorities, retrieves relevant history, and delegates approved coding tasks into provider-fixed threads. Each task gets:

- a dedicated Discord thread for streaming output and decisions;
- one immutable provider session (Claude, Codex, or OpenCode);
- an isolated Git branch and worktree;
- durable SQLite state for recovery, journaling, and memory.

## Who this is for

Operators who want a shared, auditable, least-privilege workspace where trusted team members can run coding agents against local repositories without sharing terminal access, provider credentials, or API keys.

## Not intended for

- Public-facing bots or multi-tenant SaaS hosting.
- Automated CI/CD pipeline execution.
- Untrusted Discord members (every command is gated by role authorization).

## Core differentiators

- **PM-style primary agent** — one natural-language point of contact in `#agent-chat` for planning, delegation, and concise reporting. The primary agent has no repository tools and cannot bypass the task coordinator.
- **Provider-neutral runtime** — Claude, Codex, and OpenCode adapters feed the same durable task contract and normalized event model. Provider switching is a confirmed sibling handoff, not an in-place session conversion.
- **Isolated Git worktrees** — every Git-backed task runs on its own branch in a separate worktree. Dirty worktrees are never force-removed.
- **Durable state and recovery** — projects, tasks, sessions, events, and results live in SQLite. Nonterminal tasks become `interrupted` after a restart; no provider turn is replayed automatically.
- **Discord-native decisions** — buttons, select menus, and native polls collect approvals and input without command syntax.
- **Quiet usage admission** — provider windows, calibrated task estimates, and active reservations are managed internally. The coordinator only surfaces constraints when capacity is critical.
- **Least-privilege Discord model** — the bot runs with minimal permissions and a capability registry that provides diagnostics and graceful fallbacks.

## Architecture

```text
Discord messages / commands
            │
            ▼
      TaskCoordinator
       │     │      │
       │     │      └── DiscordTaskRenderer + DiscordInteractionBroker
       │     └───────── Task/Event/Project repositories → SQLite
       └─────────────── WorktreeManager → isolated Git worktree
            │
            ▼
      ProviderRegistry
            │
            ├── ClaudeProvider   → Claude Agent SDK
            ├── CodexProvider    → Codex App Server
            └── OpenCodeProvider → OpenCode ACP
```

`TaskCoordinator` owns lifecycle ordering. Handlers never call provider SDKs directly.

## Provider support

| Provider | Transport | Task execution | Primary agent | Session continuation | Cancellation |
|---|---|---|---|---|---|
| Claude | Agent SDK | Full | Full (tool-disabled) | Yes | Yes |
| Codex | App Server JSON-RPC | Full | Full (read-only, network-disabled) | Yes | Yes |
| OpenCode | ACP CLI | Full | Full (deny-all agent, disposable directory) | When ACP advertises capability | Yes |

## Quickstart

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
cp .env.example .env
```

Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and `AUTHORIZED_ROLE_IDS` in `.env`. Then:

```bash
npm run register     # Register slash commands
npm run dev          # Start the bot
```

On first start, open `#agent-chat` and select a provider. Run `/add-project` to register a Git repository, then send a normal message in its `#agent` channel to create a task.

See the [tutorial](docs/tutorials/run-your-first-agent-task.md) for a complete guided walkthrough.

## Security and trust

- Every command is checked against `AUTHORIZED_ROLE_IDS`.
- Project paths can be restricted with `PROJECTS_BASE_DIR`.
- Git commands use argument arrays with `shell: false`.
- Provider credentials, API keys, device codes, and webhook tokens are never stored in SQLite.
- Sensitive content is redacted before SQLite persistence, Discord rendering, and logs.
- Claude loads user-level settings only; project/local Claude settings are ignored.
- The primary agent has no repository tools and cannot bypass `TaskCoordinator`.
- Interrupted work is preserved and requires explicit user action to resume.

## Documentation

| For | Start here |
|---|---|
| Learn with a guided tutorial | [Tutorials](docs/tutorials/run-your-first-agent-task.md) |
| Accomplish a specific task | [How-to guides](docs/how-to/README.md) |
| Look up commands, config, or states | [Reference](docs/reference/README.md) |
| Understand architecture and design | [Explanation](docs/explanation/README.md) |
| Contribute to the project | [Contributing](CONTRIBUTING.md) |

## License

MIT. See [LICENSE](LICENSE). Copyright and permission notices from DiscordClaude are preserved as required by the upstream license.

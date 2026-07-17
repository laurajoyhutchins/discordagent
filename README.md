# Discord Agent

Discord Agent is a private, local-first Discord workspace for running coding agents against repositories on the machine hosting the bot. It is based on [Nicolai Lolansen's DiscordClaude](https://github.com/NicolaiLolansen/DiscordClaude) and retains the upstream MIT license and attribution.

Discord Agent provides a provider-neutral runtime with executable Claude, Codex, and optional OpenCode task providers. Codex runs through the local App Server protocol, while OpenCode runs through the local `opencode acp` CLI with ACP streaming, approvals, session continuation, and cancellation.

## What the runtime provides

- **Persistent primary-agent chat** — a private `#agent-chat` channel provides one PM-style point of contact for natural conversation, planning, delegation, and concise reporting.
- **Natural-language project channels** — each registered project receives a private `#agent` channel.
- **Task threads** — each new prompt creates a Discord thread representing one durable agent task and one immutable provider session.
- **Isolated Git worktrees** — each Git-backed task receives its own branch and writable worktree before provider execution begins.
- **Durable state** — projects, tasks, worktrees, provider sessions, events, results, and recovery checkpoints are stored in SQLite.
- **Claude and Codex adapters** — Claude uses the Agent SDK; Codex uses the local App Server JSONL protocol behind the same provider contract.
- **Streaming and approvals** — responses, plans, commands, file changes, approvals, and user questions are rendered through provider-neutral Discord components.
- **Continuation and cancellation** — replies continue the same provider session; `/cancel` cancels the task associated with the current thread.
- **Safe restart recovery** — nonterminal tasks are marked interrupted, their worktrees are preserved, and no provider turn is replayed automatically.
- **Recurring tasks** — a loop reuses one thread, task, worktree, and provider session without overlapping iterations.
- **Roborev routing** — optional reviews are posted by the authenticated bot directly to `#roborev`; webhook credentials are not created or stored.
- **Durable memory and retrieval** — the primary agent uses a SQLite journal, FTS5 retrieval, provenance-controlled memory, and bounded context assembly.
- **Discord-native decisions** — confirmations, select menus, and native polls collect user choices without turning routine conversation into command syntax.
- **Quiet usage admission** — provider windows, calibrated task estimates, and active reservations are managed internally; `/usage` and `/agents` expose details on demand, while normal conversation surfaces only material constraints.

OpenCode is an optional local task provider. Install the OpenCode CLI and run `opencode auth login` on the bot host before selecting it in a project channel. Discord Agent invokes only `opencode acp`, uses ACP streaming and explicit Discord approvals, and persists the ACP session for continuation. It does not automatically fall back to Claude or Codex when OpenCode is unavailable or fails.

## Safety model

Discord Agent is intended for a private server with trusted users and repositories.

- Every command and message is checked against `AUTHORIZED_ROLE_IDS`.
- Registered paths can be restricted with `PROJECTS_BASE_DIR`.
- Git-backed tasks run in isolated worktrees rather than the project's primary checkout.
- Git commands use argument arrays with `shell: false`.
- Dirty task worktrees are never force-removed.
- Provider identity cannot change inside an existing task thread.
- Claude loads user-level settings only. Project and local Claude settings are ignored so repository content cannot weaken global approval policy.
- Provider credentials, API keys, device codes, and Roborev webhook tokens are never stored in SQLite.
- Sensitive provider and task content is redacted before SQLite persistence, Discord rendering, and logs.
- Interrupted work is preserved and requires an explicit user message to resume.

## Prerequisites

- Node.js 22 or newer
- Git
- A private Discord server where you can install a bot
- At least one provider installed and authenticated on the bot host
- Claude Code, Codex CLI, and OpenCode CLI are optional; install and authenticate at least one provider on the bot host

Run the provider you intend to use once locally to complete authentication. Codex can also be authenticated privately from Discord with `/codex-auth login`, or locally with `codex login --device-auth`. For OpenCode, install the OpenCode CLI and run `opencode auth login` on the bot host. OpenCode is invoked only through `opencode acp`; the bot does not implement a batch or automatic fallback transport.

## Installation

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
cp .env.example .env
```

Configure the required values in `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
AUTHORIZED_ROLE_IDS=your-authorized-role-id
```

Register commands and start the bot:

```bash
npm run register
npm run dev
```

On the first start, open the private `#agent-chat` channel and choose an available provider. That selection powers the PM chat and becomes the default for new projects. If Codex is selected, complete `/codex-auth login` first when the setup prompt asks for it. Claude and Codex are both optional at runtime; set `CLAUDE_ENABLED=false` for a Codex-only host.

For production-style execution:

```bash
npm run build
npm start
```

## Discord bot permissions

The bot requires the message-content and server-members privileged intents. It needs permission to view channels, send messages, embed links, create and manage threads, and create/delete project channels. Roborev uses the bot identity; `Manage Webhooks` is no longer required by Discord Agent itself.

## Registering a project

OpenCode is intentionally excluded from PM provider onboarding. Select Claude or Codex for `#agent-chat`, then choose OpenCode in a project channel after its local ACP availability check succeeds.

Choose the global provider in `#agent-chat` before registering a project. Then run this in the configured guild:

```text
/add-project name:factory-floor path:/absolute/path/to/factory-floor
```

The bot creates a category named for the project and a private `#agent` channel. The project inherits the global provider at creation time; use `/provider` in the project channel to override it later. When Roborev is enabled, it also creates `#roborev`.

Send a normal message in `#agent` to create a task. Discord Agent will:

1. select the project's default provider;
2. create a Discord task thread;
3. create a dedicated Git branch and worktree;
4. persist the task and worktree mapping;
5. start the provider and persist its session identity;
6. stream normalized events into the thread;
7. store the result while preserving the thread for later continuation.

## Commands

| Command | Behavior |
|---|---|
| `/add-project` | Register a local project and create its channels. |
| `/list-projects` | List active projects, providers, models, and channels. |
| `/remove-project` | Soft-archive the project record and delete its Discord channels. Historical tasks remain in SQLite. |
| `/provider [claude\|codex\|opencode]` | Show or change the global PM provider in `#agent-chat`, or the project's default provider in a project channel, after an authoritative availability check. OpenCode is task-only and cannot become the PM provider. In a task thread, proposing another provider creates a confirmed sibling handoff. |
| `/model [model] [custom]` | Set the model override for the project's current provider. |
| `/cancel` | In a task thread, cancel that durable task while preserving its worktree. |
| `/loop <prompt> [interval]` | Start a recurring task in one thread/session/worktree. |
| `/stop-loop` | Stop the loop associated with the project or loop thread. |
| `/agents` | Show active task threads, providers, status, and reserved capacity. |
| `/usage` | Show provider windows, operating posture, and active reservations. |
| `/codex-auth status\|login\|logout` | Check, establish, or revoke Codex authentication using owner-only ephemeral controls. |

Text commands in `#agent` include `/provider`, `/model`, `/loop`, `/stop-loop`, and `/status`. Ordinary natural-language messages are the default interface.

## Provider behavior

### Claude

Claude executes through `@anthropic-ai/claude-agent-sdk`.

Model precedence is:

1. one-message `/model <name> <prompt>` override;
2. provider-scoped project model;
3. `CLAUDE_MODEL` environment value;
4. Claude SDK default.

Claude continues to respect `~/.claude/settings.json`. Project-level `.claude/settings.json` and `.claude/settings.local.json` are deliberately ignored.

### Codex

Codex runs through a singleton local App Server process using newline-delimited JSON requests, responses, notifications, and server-initiated approval/input requests. A Codex task persists the returned thread identifier before awaiting turn completion, streams normalized plans/commands/file changes/diffs/usage, and maps Discord decisions back to App Server approval values.

When sign-in is required, the original request is held in memory for up to 30 minutes without creating a thread or worktree. `/codex-auth login` shows the OpenAI device URL and one-time code only in an ephemeral owner interaction. The bot performs a fresh account read after completion and requires an explicit **Start task** or **Discard** action. API keys and secret tool inputs are never requested through Discord.

A provider change inside a completed task thread is a confirmed sibling handoff, not an in-place session conversion. The new task receives a fresh provider session and isolated worktree based on the committed source-task branch. The handoff transfers a bounded structured summary rather than the complete transcript.

### OpenCode

OpenCode runs through the local `opencode acp` CLI and the official ACP client transport. It streams normalized text, plans, commands, file changes, usage, and status events, and maps ACP permission requests to explicit Discord approvals. A task persists its ACP session identity before completion is awaited so replies can continue the same OpenCode session when the server advertises loading or resuming.

OpenCode is available for project task channels and confirmed task-thread handoffs only. PM-style `#agent-chat` support is deferred until a restricted primary adapter exists. The runtime never silently switches providers or starts a fallback batch command.

## Git worktrees

Task branches use this shape:

```text
agent/<provider>/<task-slug>-<thread-suffix>
```

The base branch resolution order is:

1. the project's explicitly configured base branch;
2. the symbolic remote default such as `origin/main`;
3. the current local branch.

`WORKTREES_BASE_DIR` controls where task worktrees are placed. Discord Agent refuses unsafe worktree cleanup when uncommitted changes exist and never uses force removal or force reset.

## Persistence and recovery

Operational state is stored in SQLite at `DATABASE_PATH`. By default, development uses `src/data/discordagent.sqlite`; compiled execution uses `dist/data/discordagent.sqlite`.

SQLite stores:

- projects and provider-scoped model settings;
- tasks and immutable provider identities;
- worktrees and branches;
- provider session identifiers;
- normalized task events and terminal results;
- the complete primary-agent conversation journal and FTS index;
- durable memory records and revision provenance;
- provider usage snapshots, task-cost observations, and capacity reservations.

On startup, tasks left in `starting`, `running`, or `waiting_for_user` become `interrupted`. Discord Agent inspects the recorded worktree, writes a recovery event, and posts a concise checkpoint in the original thread when it is still available. **No provider turn is automatically replayed.**

## Migrating from DiscordClaude

Discord Agent performs a one-time import from `src/data/projects.json` when that file exists:

- `claudeChannelId` becomes `agentChannelId`; existing Discord channels remain usable and do not need to be recreated.
- The legacy project model becomes the Claude-scoped model.
- The default provider becomes Claude.
- Roborev channel IDs are retained.
- Roborev webhook IDs and tokens are discarded.
- Legacy session IDs may be recorded only as migration metadata; **old provider sessions are not automatically resumed**.

The original JSON file is not the operational database after migration. Project removal is a soft archive so historical task records keep referential integrity.

## Roborev

When enabled, the bot starts `roborev stream`, matches events to registered repository paths, and sends review embeds directly to the project's `#roborev` channel through the Discord bot client. Discord Agent does not create, DM, persist, or use Roborev webhook credentials.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `DISCORD_TOKEN` | yes | — | Discord bot token. |
| `DISCORD_CLIENT_ID` | yes | — | Discord application ID. |
| `DISCORD_GUILD_ID` | yes | — | Private server ID. |
| `AUTHORIZED_ROLE_IDS` | yes | — | Comma-separated authorized role IDs. |
| `NOTIFY_USER_ID` | no | empty | User to mention after task completion. |
| `AUTHORIZED_USER_ID` | primary/Codex auth | `NOTIFY_USER_ID` | Exact owner allowed to use `#agent-chat` and manage Codex login. |
| `AUTHORIZED_USER_ID` | Codex auth | `NOTIFY_USER_ID` | Exact human owner allowed to manage Codex authentication. |
| `CODEX_CLI_PATH` | no | `codex` (`codex.cmd` on Windows when installed through Volta) | Codex CLI executable used to launch App Server. |
| `CODEX_MODEL` | no | provider default | Default Codex model. |
| `CODEX_ENABLED` | no | `true` | Enable local Codex App Server startup. |
| `OPENCODE_CLI_PATH` | no | `opencode` | OpenCode CLI executable used to launch ACP. |
| `OPENCODE_MODEL` | no | provider default | Default OpenCode model. |
| `OPENCODE_TIMEOUT_MS` | no | `900000` | OpenCode ACP turn timeout. |
| `OPENCODE_ENABLED` | no | `true` | Keep OpenCode available as a selectable task provider when its ACP probe succeeds. |
| `PRIMARY_AGENT_MODEL` | no | provider default | Optional model used by the restricted PM-style coordinator. |
| `PRIMARY_USAGE_RESERVE` | no | `10` | Capacity percentage points preserved for coordination and recovery. |
| `CLAUDE_TIMEOUT_MS` | no | `900000` | Provider turn timeout. |
| `CLAUDE_ENABLED` | no | `true` | Keep Claude available as a selectable provider; set `false` on Codex-only hosts. |
| `CLAUDE_MODEL` | no | SDK default | Default Claude model. |
| `PROJECTS_BASE_DIR` | no | unrestricted | Root beneath which projects may be registered. |
| `ALLOW_NON_GIT` | no | `false` | Legacy registration switch. Agent task execution still requires a Git repository for worktree isolation. |
| `DATABASE_PATH` | no | runtime data directory | SQLite database path. |
| `WORKTREES_BASE_DIR` | no | beside database | Isolated task worktree directory. |
| `ROBOREV_CLI_PATH` | no | `roborev` | Roborev executable path. |
| `USAGE_CHANNEL_ID` | no | empty | Optional detailed usage channel. |
| `INSTANCE_LOCK_PORT` | no | `47831` | Localhost single-instance lock. |

## Development

```bash
npm ci
npm test
npm run build
```

Useful commands:

```bash
npm run test:watch
npm run test:coverage
npm run check
```

The detailed lifecycle and persistence design is in [`docs/architecture/provider-neutral-runtime.md`](docs/architecture/provider-neutral-runtime.md). The approved specification and task plan remain under `docs/superpowers/`.

## Primary-agent and usage behavior

The primary agent is a project owner / PM, not a hidden coding session. It has no repository tools, no project MCP access, and cannot bypass the durable task coordinator. It discusses priorities, retrieves relevant history, proposes bounded work, delegates approved tasks into provider-fixed threads, and summarizes outcomes.

Usage management is intentionally quiet. The coordinator tracks provider-reported windows, active reservations, and historical task classes internally. It only interrupts normal conversation when a task is unusually expensive, cannot be completed reliably, should be narrowed or deferred, or a running turn must be checkpointed. Preserve-mode interruption occurs at most once per turn and retains the provider session, branch, and worktree.

## License

MIT. See [`LICENSE`](LICENSE). Copyright and permission notices from DiscordClaude are preserved as required by the upstream license.

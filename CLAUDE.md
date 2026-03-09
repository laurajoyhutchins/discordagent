# CLAUDE.md

## Project Overview

DiscordClaude is a Discord bot that orchestrates Claude Code remotely via the Anthropic Agent SDK. Users send prompts in Discord `#claude` channels, and the bot runs Claude Code locally, streaming responses back as threaded messages with rich embeds for tool usage.

## Tech Stack

- **Runtime:** Node.js v22+, TypeScript (ES2022 modules)
- **Discord:** discord.js v14
- **AI:** @anthropic-ai/claude-agent-sdk (Agent SDK, uses Pro/Max subscription — no API key)
- **Build:** tsx (dev), tsc (production)

## Quick Reference

```bash
npm run dev        # Run in development mode (tsx)
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled output (node dist/index.js)
npm run register   # Force re-register slash commands with Discord
```

## Architecture

```
Discord message → messageHandler.ts → claudeRunner.ts → Agent SDK query()
                                                       ↓
Discord slash cmd → interactionHandler.ts → command handler (addProject, cancel, loop, etc.)
                                                       ↓
                  discordStreamer.ts ← streams response ← Agent SDK
                  (throttled edits, tool embeds, approval buttons)
```

### Key Design Decisions

- **Sessions map by thread ID** — `activeSessions` is keyed by thread ID, allowing multiple concurrent threads per `#claude` channel. Each thread has its own independent session with its own `sessionId` and `AbortController`.
- **Tool approval is collect-then-verify** — `awaitMessageComponent` filters must be synchronous, so we accept any button click, then verify auth with an async `members.fetch()` after. Unauthorized clicks get an ephemeral rejection and the bot waits for the next click.
- **setTimeout chaining for loops** — `setInterval` could cause overlapping iterations if Claude runs longer than the interval. We use `setTimeout` after each iteration completes. Loop embeds include a "Stop Loop" button handled via button interaction in `interactionHandler.ts`.
- **`/cancel` is context-aware** — In a thread, cancels that thread's session. In the main channel, cancels all active sessions and any running loop.
- **In-memory project cache** — `projectStore.ts` loads from disk once on startup, then serves from cache. Writes are async and serialized via a promise queue to prevent race conditions.
- **Settings restricted to `['user']`** — Claude Code's `settingSources` is set to `['user']` only (not `['user', 'project', 'local']`) to prevent malicious project-level `.claude/` configs from altering behavior. Users' `~/.claude/settings.json` is respected.
- **Roborev is optional** — Not set up by default. Auto-detected if the `roborev` CLI is available AND the project has roborev config. Can be explicitly enabled/disabled via the `roborev` option on `/add-project`.
- **Non-git directories** — Blocked by default. Set `ALLOW_NON_GIT=true` to allow registering non-git directories. This is a safety trade-off documented in the README.

## File Guide

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — Discord client, event wiring, shutdown |
| `src/config.ts` | Loads env vars, validates required ones |
| `src/types.ts` | `Project`, `ProjectStore`, `ActiveSession` interfaces |
| `src/commands/definitions.ts` | SlashCommandBuilder definitions for all 6 commands |
| `src/commands/addProject.ts` | Registers project, creates channels, optional roborev setup |
| `src/commands/removeProject.ts` | Removes project, cancels session, deletes channels |
| `src/commands/listProjects.ts` | Lists projects with status in ephemeral embed |
| `src/commands/cancel.ts` | Cancels active Claude session via AbortController |
| `src/commands/loop.ts` | Starts recurring prompt with interval validation |
| `src/commands/stopLoop.ts` | Stops running loop |
| `src/commands/register.ts` | Standalone script to register slash commands |
| `src/handlers/interactionHandler.ts` | Routes slash commands, centralized auth check |
| `src/handlers/messageHandler.ts` | Handles messages in `#claude` channels and threads |
| `src/handlers/threadDeleteHandler.ts` | Cleans up sessions when threads are deleted |
| `src/services/claudeRunner.ts` | Core — manages Agent SDK sessions, tool approval, timeouts |
| `src/services/discordStreamer.ts` | Streams Claude output to Discord with throttled edits |
| `src/services/projectStore.ts` | CRUD for projects.json with in-memory cache |
| `src/services/channelManager.ts` | Creates/deletes Discord categories, channels, webhooks |
| `src/services/loopRunner.ts` | Recurring prompt execution with setTimeout chaining |
| `src/services/roborevWatcher.ts` | Spawns `roborev stream`, routes reviews to webhooks |
| `src/utils/permissions.ts` | `isAuthorized()` — role-based auth check |
| `src/utils/chunker.ts` | Splits text into Discord-safe 1800-char chunks |

## Auto-Approved Tools

These tools run without requiring user approval (read-only, no side effects):

- `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `TodoRead`, `TodoWrite`

All other tools (`Bash`, `Edit`, `Write`, `Agent`, etc.) require Allow/Deny button approval.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | — | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | — | Application ID |
| `DISCORD_GUILD_ID` | Yes | — | Server ID |
| `AUTHORIZED_ROLE_IDS` | Yes | — | Comma-separated role IDs |
| `NOTIFY_USER_ID` | No | `""` | User ID to ping on session completion |
| `CLAUDE_TIMEOUT_MS` | No | `900000` | Session auto-cancel timeout (15 min) |
| `ROBOREV_CLI_PATH` | No | `roborev` | Path to roborev binary |
| `PROJECTS_BASE_DIR` | No | `""` | Restrict allowed project paths |
| `ALLOW_NON_GIT` | No | `false` | Allow registering non-git directories |

## Claude Code Configuration

The bot uses `settingSources: ['user']` in `claudeRunner.ts`, which means:

- **Loaded:** `~/.claude/settings.json` (user-level settings)
- **Ignored:** `.claude/settings.json` (project-level), `.claude/settings.local.json` (local)

This is intentional for security — project-level configs could auto-approve dangerous tools. Users' pre-approved tools (e.g., `Bash(npm test)`) in their user settings carry over to the bot.

To change this behavior (e.g., to also load project settings), modify the `settingSources` array in `claudeRunner.ts`. Be aware this weakens security if the bot manages untrusted repositories.

## Security Model

1. **Authorization** — All slash commands go through `interactionHandler.ts` which calls `isAuthorized()` before dispatching. Message-based commands check auth in `messageHandler.ts`. Individual handlers also have their own auth checks (defense-in-depth).
2. **Tool approval** — The `canUseTool` callback in `claudeRunner.ts` gates destructive tools behind Discord button approval. Auth is verified on the button clicker.
3. **Path traversal** — `addProject.ts` resolves symlinks with `realpathSync()` and validates against `PROJECTS_BASE_DIR` if configured.
4. **No shell injection** — `roborevWatcher.ts` uses `execFile` (not `exec`/`execSync`) and `spawn` with `shell: false`.
5. **Settings isolation** — Only user-level Claude Code settings are loaded. Project/local settings ignored to prevent trust escalation.

## Common Tasks

### Adding a new slash command

1. Add the `SlashCommandBuilder` to `src/commands/definitions.ts`
2. Create the handler in `src/commands/yourCommand.ts`
3. Add the case to the switch in `src/handlers/interactionHandler.ts`
4. Restart the bot (commands are registered on startup)

### Adding a new text command

1. Add parsing logic to `handleBotCommand()` in `src/handlers/messageHandler.ts`
2. Text commands are prefixed with `/` and intercepted before being sent to Claude

### Adding a new auto-approved tool

Add the tool name to `AUTO_APPROVED_TOOLS` in `src/services/claudeRunner.ts`. Only add read-only tools with no side effects.

### Enabling project-level Claude Code settings

If you trust all registered projects, you can change `settingSources` in `src/services/claudeRunner.ts`:

```typescript
// Current (secure default):
settingSources: ['user'],

// To also load project settings:
settingSources: ['user', 'project'],

// To load everything (including local overrides):
settingSources: ['user', 'project', 'local'],
```

> **Warning:** This allows `.claude/settings.json` in any registered project to auto-approve tools, which could be exploited by malicious repos.

# DiscordClaude

A Discord bot that lets you control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) remotely from any device. Each project gets its own Discord category with a `#claude` channel for prompts and a `#roborev` channel for automated code reviews.

## Features

- **Remote Claude Code** — Send prompts in Discord, get streamed responses in threads
- **Session persistence** — Conversations resume across messages and bot restarts
- **Thread-based workflow** — Each prompt creates a thread; reply to continue the conversation
- **Tool visibility** — See what Claude is doing (file edits, bash commands) via rich embeds
- **Tool approval** — Allow/Deny buttons for tools not in your auto-approve list
- **AskUserQuestion** — Claude can ask clarifying questions via Discord buttons
- **Multi-project** — Each project gets its own channel category, concurrent sessions supported
- **Roborev integration** — Automated code reviews posted to `#roborev` channels via webhook
- **Ping on completion** — Get notified when Claude finishes a task
- **Uses your subscription** — Runs via the Agent SDK using your Pro/Max plan, no API key needed

## Prerequisites

- Node.js v22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A Discord bot application ([setup guide](#discord-setup))

## Quick Start

```bash
git clone https://github.com/your-username/DiscordClaude.git
cd DiscordClaude
npm install
cp .env.example .env
cp src/data/projects.example.json src/data/projects.json
# Edit .env with your values
npm run dev
```

## Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Under **Bot**:
   - Copy the bot token
   - Enable **MESSAGE CONTENT INTENT**, **SERVER MEMBERS INTENT**, and **PRESENCE INTENT**
3. Under **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Administrator` (or manually select: Manage Channels, Manage Webhooks, Send Messages, Create Public Threads, Send Messages in Threads, Manage Messages, Add Reactions, View Channels)
   - Open the generated URL to invite the bot
4. In your server, create a role for authorized users and assign it
5. Enable **Developer Mode** in Discord settings (User Settings > Advanced) to copy IDs

## Configuration

Copy `.env.example` to `.env` and fill in:

```env
# Required
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
AUTHORIZED_ROLE_IDS=role-id-1,role-id-2

# Optional
NOTIFY_USER_ID=your-discord-user-id    # Get pinged when sessions complete
CLAUDE_TIMEOUT_MS=900000                # Session timeout (default: 15 min)
ROBOREV_CLI_PATH=roborev               # Path to roborev binary
```

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/add-project <name> <path>` | Register a project — creates a category with `#claude` and `#roborev` channels |
| `/list-projects` | Show all registered projects and their status |
| `/remove-project <name>` | Remove a project and clean up its channels |
| `/cancel` | Cancel the active Claude session in the current channel |

### Workflow

1. Run `/add-project myapp /path/to/repo` to register a project
2. Send a message in `#claude` — a thread is created with Claude's response
3. Reply in the thread to continue the conversation (session is resumed)
4. Start a new prompt in `#claude` for a fresh task
5. Delete a thread to clean up the session

### Roborev

If you have [Roborev](https://roborev.dev) installed, the bot automatically:
- Spawns `roborev stream` to listen for review events
- Routes reviews to the correct project's `#roborev` channel
- Displays color-coded embeds by severity (info/warning/error)

Install the roborev hook in each project:
```bash
cd /path/to/project
roborev install-hook
```

## Architecture

```
You (Discord on phone/PC)
  -> Discord API (WebSocket)
  -> Bot process (your machine)
  -> Agent SDK -> Claude Code (same machine, uses your subscription)
  -> Streams output back to Discord thread
```

The bot runs as a headless Node.js process. No ports are opened — it connects outbound to Discord via WebSocket. Claude Code runs locally with full access to your project files.

## Project Structure

```
src/
  index.ts                    # Client init, login, event registration
  config.ts                   # Env loading + validation
  types.ts                    # Shared interfaces
  commands/
    definitions.ts            # Slash command definitions
    register.ts               # Standalone command registration script
    addProject.ts             # /add-project handler
    listProjects.ts           # /list-projects handler
    removeProject.ts          # /remove-project handler
    cancel.ts                 # /cancel handler
  services/
    projectStore.ts           # JSON CRUD for project configs
    channelManager.ts         # Create/delete categories, channels, webhooks
    claudeRunner.ts           # Agent SDK query management, session resume
    discordStreamer.ts         # Throttled message editing, chunking, tool embeds
    roborevWatcher.ts         # Roborev JSONL stream parser, webhook routing
  handlers/
    messageHandler.ts         # Messages in #claude channels + thread follow-ups
    interactionHandler.ts     # Routes slash commands
    threadDeleteHandler.ts    # Cleans up sessions on thread deletion
  utils/
    chunker.ts                # Split text into Discord-safe chunks
    permissions.ts            # Role-based auth checks
  data/
    projects.json             # Runtime project state (gitignored)
```

## License

MIT

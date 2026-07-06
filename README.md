# DiscordClaude

A Discord bot that lets you control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) remotely from any device. Each project gets its own Discord category with a `#claude` channel for prompts, and optionally a `#roborev` channel for automated code reviews.

## Features

- **Remote Claude Code** — Send prompts in Discord, get streamed responses in threads
- **Session persistence** — Conversations resume across messages and bot restarts
- **Thread-based workflow** — Each prompt creates a thread; reply to continue the conversation
- **Tool visibility** — See what Claude is doing (file edits, bash commands) via rich embeds
- **Tool approval** — Allow/Deny buttons for destructive tools (Bash, Edit, Write)
- **AskUserQuestion** — Claude can ask clarifying questions via Discord buttons or free-text
- **Loops** — Run prompts on a recurring interval (`/loop 5m run the tests`)
- **Model picker** — Choose Sonnet/Opus/Haiku per project with `/model`, or per prompt with a `/model <name>` prefix
- **Usage tracking** — `/usage` shows rate-limit utilization; per-session stats can post to a `#usage` channel
- **Multi-project** — Each project gets its own channel category, concurrent sessions supported
- **Roborev integration** — Optional automated code reviews posted to `#roborev` channels
- **Non-git support** — Optionally register directories that aren't git repos
- **Uses your Claude Code config** — Respects your existing `~/.claude/` settings
- **Ping on completion** — Get notified when Claude finishes a task
- **Uses your subscription** — Runs via the Agent SDK on your Pro/Max plan, no API key needed
- **Self-healing connection** — Single-instance lock, gateway health monitoring, and automatic reconnect

## Prerequisites

- **Node.js** v22+ ([download](https://nodejs.org/))
- **Claude Code CLI** installed and authenticated — run `claude` once to sign in
- **A Discord server** you have admin access to

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name (e.g. "Claude Code"), and create it
3. Go to **Bot** in the sidebar:
   - Click **Reset Token**, copy the token — this is your `DISCORD_TOKEN`
   - Scroll down to **Privileged Gateway Intents** and enable:
     - ✅ **MESSAGE CONTENT INTENT**
     - ✅ **SERVER MEMBERS INTENT**
     - ✅ **PRESENCE INTENT**
   - Click **Save Changes**
4. Go to **OAuth2 > URL Generator** in the sidebar:
   - Under **Scopes**, check: `bot`, `applications.commands`
   - Under **Bot Permissions**, check: `Administrator`
     > Or manually select: Manage Channels, Manage Webhooks, Send Messages, Create Public Threads, Send Messages in Threads, Manage Messages, Add Reactions, View Channels, Embed Links, Read Message History
   - Copy the generated URL at the bottom and open it in your browser
   - Select your server and click **Authorize**
5. Copy your **Application ID** from the **General Information** page — this is your `DISCORD_CLIENT_ID`

### 2. Get Server & Role IDs

1. In Discord, go to **User Settings > Advanced** and enable **Developer Mode**
2. Right-click your server name → **Copy Server ID** — this is your `DISCORD_GUILD_ID`
3. Create a role for authorized users (e.g. "Claude User"):
   - Go to **Server Settings > Roles > Create Role**
   - Name it whatever you like, no special permissions needed
   - Assign this role to yourself (and anyone else who should use the bot)
4. Right-click the role → **Copy Role ID** — this is your `AUTHORIZED_ROLE_IDS`

### 3. Install & Run

```bash
git clone https://github.com/NicolaiLolansen/DiscordClaude.git
cd DiscordClaude
npm install
```

Create your config files:

```bash
cp .env.example .env
cp src/data/projects.example.json src/data/projects.json
```

Edit `.env` with the values from above:

```env
# Required — paste your values here
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
AUTHORIZED_ROLE_IDS=your-role-id

# Optional
NOTIFY_USER_ID=your-discord-user-id    # Get pinged when sessions complete
CLAUDE_TIMEOUT_MS=900000                # Session timeout in ms (default: 15 min)
PROJECTS_BASE_DIR=                      # Restrict project paths to this directory
ROBOREV_CLI_PATH=roborev               # Path to roborev binary (if installed)
ALLOW_NON_GIT=false                    # Allow registering non-git directories (see below)
USAGE_CHANNEL_ID=                      # Channel for per-session usage stats
CLAUDE_MODEL=                          # Default model (sonnet/opus/haiku or exact ID)
INSTANCE_LOCK_PORT=47831               # Localhost port used as single-instance lock
```

Start the bot:

```bash
npm run dev
```

You should see:

```
Logged in as YourBot#1234
Slash commands registered.
```

### 4. Add Your First Project

In any Discord channel, run:

```
/add-project name:myapp path:/path/to/your/repo
```

The bot will create a category with a `#claude` channel. If [Roborev](https://roborev.dev) is detected for the project, a `#roborev` channel is also created automatically.

Type a prompt in `#claude` to start using Claude Code remotely.

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/add-project <name> <path> [roborev]` | Register a project — creates `#claude` (and optionally `#roborev`) channels |
| `/list-projects` | Show all registered projects and their status |
| `/remove-project <name>` | Remove a project and clean up its channels |
| `/cancel` | Cancel the active Claude session |
| `/loop <prompt> [interval]` | Run a prompt on a recurring interval (default: 10m) |
| `/stop-loop` | Stop the running loop in the current channel |
| `/usage` | Show Claude Code rate-limit utilization and session stats |
| `/model [model] [custom]` | Pick the Claude model for this project (interactive dropdown if no option given) |

### Text Commands

You can also type these directly in `#claude` channels:

| Command | Example |
|---------|---------|
| `/loop [interval] <prompt>` | `/loop 5m check for failing tests` |
| `/stop-loop` | `/stop-loop` |
| `/status` | Show the running loop's status |
| `/model <name>` | `/model opus` — set the project's default model |
| `/model <name> <prompt>` | `/model haiku summarize the readme` — one-shot model override |

### Workflow

1. **Register a project:** `/add-project myapp /path/to/repo`
2. **Send a prompt:** Type in `#claude` — a thread is created with Claude's response
3. **Continue the conversation:** Reply in the thread (session is automatically resumed)
4. **Approve tools:** Click Allow/Deny on buttons for Bash, Edit, Write operations
5. **Answer questions:** Claude can ask you questions via buttons or free-text in the thread
6. **Start a new task:** Send another message in `#claude` for a fresh thread
7. **Run recurring tasks:** `/loop 5m run the linter` to run every 5 minutes

## Roborev Integration (Optional)

[Roborev](https://roborev.dev) provides automated code reviews. Integration is **optional** and **not enabled by default**.

### How it works

When you register a project, the bot checks:
1. Is the `roborev` CLI installed and accessible?
2. Does the project directory have a roborev config (`.roborev`, `.roborev.json`, or a `post-commit` hook)?

If **both** are true, the bot auto-creates a `#roborev` channel. Otherwise, only `#claude` is created.

### Explicitly enabling or disabling

```
# Force enable roborev (even if not auto-detected)
/add-project name:myapp path:/path/to/repo roborev:true

# Force disable roborev (skip even if detected)
/add-project name:myapp path:/path/to/repo roborev:false
```

### Setting up roborev for a project

```bash
# Install the roborev git hook in each project
cd /path/to/project
roborev install-hook
```

Then re-add the project (or add with `roborev:true`) to get the `#roborev` channel.

## Non-Git Directories

By default, the bot requires projects to be git repositories. This is a safety measure — git provides version control protection against destructive changes Claude might make.

### Enabling non-git support

Set `ALLOW_NON_GIT=true` in your `.env` file:

```env
ALLOW_NON_GIT=true
```

Then you can register any directory:

```
/add-project name:notes path:/Users/me/notes
```

### Risks of non-git directories

> **Warning:** Without git, there is no undo. If Claude deletes or overwrites files, you cannot recover them. You also lose:
> - `git diff` — no way to see what changed
> - `git stash` / `git checkout` — no way to revert changes
> - `git log` — no history of what happened
>
> **Recommendation:** Even for non-code projects, initialize git first: `git init && git add -A && git commit -m "initial"`. This gives you a safety net at zero cost.

## Claude Code Configuration

The bot runs Claude Code via the [Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), which respects your existing Claude Code configuration.

### What configuration is used

The bot uses `settingSources: ['user']`, which means it reads your **user-level** Claude Code settings from `~/.claude/settings.json`. This includes:

- **Allowed/denied tools** — If you've pre-approved tools (e.g., `Bash(npm test)`) in your Claude Code settings, those approvals carry over
- **Custom instructions** — Any user-level custom instructions are applied
- **Model preferences** — Your configured model is used

### What configuration is NOT used

For security, **project-level** and **local** settings are intentionally ignored:

- `.claude/settings.json` (project-level) — Not loaded
- `.claude/settings.local.json` (local) — Not loaded
- `.claude/commands/` (custom slash commands) — Not loaded

This prevents a malicious repository from injecting tool auto-approvals or instructions that could compromise the bot's security model.

### Customizing your Claude Code behavior

To configure how Claude behaves when run through the bot:

```bash
# Open your user-level settings
claude config

# Or edit directly
# macOS/Linux: ~/.claude/settings.json
```

Common settings you might want to configure:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test)",
      "Bash(npm run lint)",
      "Bash(git status)",
      "Bash(git diff)"
    ]
  }
}
```

> **Note:** Be thoughtful about what you pre-approve in user settings — those approvals apply to all projects the bot manages, not just one.

## Running in the Background

To keep the bot running after you close the terminal:

```bash
# Using nohup
nohup npm run dev > bot.log 2>&1 &

# Or build and run with node
npm run build
nohup node dist/index.js > bot.log 2>&1 &

# Or use pm2 (recommended)
npm install -g pm2
npm run build
pm2 start dist/index.js --name discord-claude
pm2 save
pm2 startup  # auto-start on reboot
```

## Architecture

```
You (Discord on phone/laptop/PC)
  -> Discord API (WebSocket)
  -> Bot process (your machine)
  -> Claude Agent SDK -> Claude Code (local, uses your subscription)
  -> Streams response back to Discord thread
```

The bot runs as a headless Node.js process on the same machine as your code. No ports are opened — it connects outbound to Discord via WebSocket. Claude Code runs locally with full access to your project files, using your Anthropic Pro/Max subscription.

## Security

- **Role-based access** — Only users with the authorized role can interact with the bot
- **Tool approval** — Destructive tools (Bash, Edit, Write) require explicit Allow/Deny
- **Path restrictions** — Set `PROJECTS_BASE_DIR` to limit which directories can be registered
- **Settings isolation** — Only user-level Claude Code settings are loaded (project/local configs ignored)
- **Session timeout** — Sessions auto-cancel after the configured timeout (default: 15 min)
- **Private webhooks** — Webhook URLs are sent via DM, never posted in channels
- **No secrets in code** — All credentials loaded from environment variables

## Troubleshooting

**Bot doesn't respond to messages:**
- Check the bot has the MESSAGE CONTENT INTENT enabled in the Developer Portal
- Make sure your user has the authorized role assigned
- Verify you're typing in the `#claude` channel (not `#roborev`)

**Bot responds slowly, twice, or misses messages:**
- Make sure only ONE bot process is running — multiple instances sharing a token
  cause duplicate replies and failed button interactions. The bot holds a localhost
  port (`INSTANCE_LOCK_PORT`) as a lock, so extra instances exit on startup.
- Check the logs for `[shard 0] Reconnecting...` loops or `SLOW PICKUP` warnings —
  each received message is logged with its gateway lag to help diagnose delays.

**Slash commands don't appear:**
- Restart the bot — commands are registered on startup
- It can take a few minutes for Discord to propagate new commands
- Try running `npm run register` to force re-registration

**"You are not authorized" error:**
- Make sure you assigned the authorized role to your Discord user
- Check `AUTHORIZED_ROLE_IDS` in `.env` matches your role ID

**Claude session times out:**
- Increase `CLAUDE_TIMEOUT_MS` in `.env` (default: 900000 = 15 min)
- The timeout resets when Claude is waiting for tool approval

**Bot can't create channels:**
- Make sure the bot has Administrator permission, or at minimum: Manage Channels, Manage Webhooks

**Roborev not detected:**
- Make sure `roborev` is in your PATH, or set `ROBOREV_CLI_PATH` in `.env`
- Run `roborev install-hook` in the project directory
- Or explicitly enable: `/add-project name:myapp path:/path roborev:true`

## Project Structure

```
src/
  index.ts                    # Client init, login, event registration
  config.ts                   # Env loading + validation
  types.ts                    # Shared TypeScript interfaces
  commands/
    definitions.ts            # Slash command definitions
    register.ts               # Standalone command registration script
    addProject.ts             # /add-project handler
    listProjects.ts           # /list-projects handler
    removeProject.ts          # /remove-project handler
    cancel.ts                 # /cancel handler
    loop.ts                   # /loop handler
    stopLoop.ts               # /stop-loop handler
    usage.ts                  # /usage handler
    model.ts                  # /model handler (per-project model picker)
  services/
    projectStore.ts           # In-memory cache + async JSON persistence
    channelManager.ts         # Create/delete categories, channels, webhooks
    claudeRunner.ts           # Agent SDK query management, session resume
    discordStreamer.ts        # Throttled message streaming, tool embeds, approval buttons
    loopRunner.ts             # Recurring prompt execution with setTimeout chaining
    usageTracker.ts           # Rate-limit + session stats, posts to #usage channel
    roborevWatcher.ts         # Roborev JSONL stream parser, webhook routing
  handlers/
    messageHandler.ts         # Messages in #claude channels + thread follow-ups
    interactionHandler.ts     # Routes slash commands to handlers
    threadDeleteHandler.ts    # Cleans up sessions on thread deletion
  utils/
    chunker.ts                # Split text into Discord-safe 1800-char chunks
    permissions.ts            # Role-based authorization checks
  data/
    projects.json             # Runtime project state (gitignored)
    projects.example.json     # Template for projects.json
```

## License

MIT

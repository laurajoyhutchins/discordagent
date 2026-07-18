# Getting Started

This tutorial walks through setting up Discord Agent for the first time: installing dependencies, configuring the bot, authenticating a provider, and running your first task.

## Prerequisites

- Node.js 22 or later
- npm
- A Discord server where you have "Manage Server" permissions
- At least one AI coding provider installed on the bot host

## Step 1: Install and build

```bash
git clone <repository-url>
cd discordagent
npm ci
npm run build
```

## Step 2: Configure the bot

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
GUILD_ID=your_server_id_here
PROJECTS_BASE_DIR=/path/to/projects
AUTHORIZED_USER_ID=your_discord_user_id
AUTHORIZED_ROLE_IDS=role_id_1,role_id_2
```

See the [Configuration reference](/docs/reference/configuration.md) for all available options.

### Discord application setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Enable these privileged Gateway Intents:
   - **Server Members Intent**
   - **Message Content Intent**
4. Use the permission calculator to generate an invite URL:

```bash
npm run discord:permissions
```

5. Invite the bot to your server with the calculated URL

## Step 3: Start the bot

```bash
npm start
```

On first run, the bot creates its SQLite database, runs migrations, and posts a provider selection prompt in `#agent-chat`.

## Step 4: Choose a provider

In `#agent-chat`, select either **Claude** or **Codex** from the setup buttons.

### If you chose Claude

Run Claude Code once locally to complete authentication before starting the bot. The bot uses the same authentication as the local CLI.

### If you chose Codex

Ensure the Codex CLI is installed on the bot host. In `#agent-chat`, use `/codex-auth login` to start the device flow, then complete it locally:

```bash
codex login --device-auth
```

After authentication, click **Check again** in Discord, then **Start task** when prompted.

## Step 5: Register a project

In any channel, use:

```
/add-project name: my-project path: /absolute/path/to/repo
```

The bot creates a category with an `#agent` channel (and optional `#roborev` channel for code review). New messages in `#agent` become tasks.

## Step 6: Run a task

In your project's `#agent` channel, send a message:

```
Implement input validation for the login form
```

The bot creates a task thread, a Git worktree on an isolated branch, and runs the provider. You'll see streaming output, file changes, and a control card pinned at the top of the thread.

To continue a task, reply in the thread.

## Step 7: Configure settings

- Use `/settings` in `#agent-chat` to configure global defaults
- Use `/project-settings` in your project channel for project-specific overrides
- Use `/capabilities` to verify Discord permissions

## Next steps

- [Setting up providers](/docs/guides/setting-up-providers.md)
- [Managing settings](/docs/guides/managing-settings.md)
- [Managing Discord permissions](/docs/guides/managing-permissions.md)

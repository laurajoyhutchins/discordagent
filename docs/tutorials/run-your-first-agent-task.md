# Run your first agent task

This tutorial walks through setting up Discord Agent for the first time and running a successful task end to end.

## Prerequisites

- Node.js 22 or later
- Git
- A Discord server where you have **Manage Server** permissions
- At least one coding agent provider installed and authenticated on the bot host

For this tutorial we use Codex as the primary provider. See the [provider how-to guides](../how-to/providers/configure-claude.md) for alternatives.

## 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Go to **Bot** and click **Add Bot**.
3. Copy the bot token — you will need it as `DISCORD_TOKEN`.
4. Copy the **Application ID** from **General Information** — this is `DISCORD_CLIENT_ID`.
5. Copy your server ID from Discord (enable Developer Mode, right-click your server, **Copy ID**) — this is `DISCORD_GUILD_ID`.
6. Enable the following privileged Gateway Intents under **Bot > Privileged Gateway Intents**:
   - **Server Members Intent**
   - **Message Content Intent**
7. Note at least one role ID on your server that will be authorized to use the bot (Server Settings > Roles > right-click a role > Copy ID).

## 2. Set required permissions

Use the permission calculator to generate an invite URL:

```bash
npm run discord:permissions
```

Copy and open the URL in a browser. Select your server and authorize the bot with the calculated permissions. Do not select **Administrator**.

## 3. Clone and install

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
cp .env.example .env
```

## 4. Configure environment variables

Edit `.env` with the values collected in step 1:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
AUTHORIZED_ROLE_IDS=role-id-1,role-id-2
```

Optionally set `PROJECTS_BASE_DIR` to restrict which directories can be registered as projects.

## 5. Complete provider authentication

Ensure Codex CLI is installed on the bot host and available in PATH (or set `CODEX_CLI_PATH` in `.env`). Run locally once to establish authentication:

```bash
codex login --device-auth
```

Complete the browser flow on the host machine. Do not send verification URLs or one-time codes to Discord.

See [configure Codex](../how-to/providers/configure-codex.md) for full authentication steps.

## 6. Run smoke checks

```bash
npm run smoke:host
```

The host preflight validates Node version, environment variables, directory writability, and CLI availability. Resolve any failures before continuing.

```bash
npm run register          # Register slash commands in your guild
npm run smoke:discord     # Verify Discord connectivity and command registration
```

Expected outcome: `npm run smoke:discord` prints the bot username, guild name, and confirms all authorized roles and commands are registered.

## 7. Start the bot

```bash
npm run dev
```

Expected log output:

```text
Instance lock acquired
Logged in as ...
```

On first start, the bot creates SQLite tables, runs migrations, creates or reconciles `#agent-chat`, and posts a provider selection prompt.

## 8. Select a provider

In the private `#agent-chat` channel, click the **Codex** button in the setup prompt. If Codex authentication is needed, use `/codex-auth login` and follow the instructions posted by the bot.

Expected outcome: The bot confirms the provider and activates the primary agent. You can now send messages in `#agent-chat`.

## 9. Register a project

Create a disposable Git repository:

```bash
mkdir -p ~/projects/discordagent-smoke
cd ~/projects/discordagent-smoke
git init
git switch -c main
echo "# Discord Agent smoke test" > README.md
git add README.md
git commit -m "chore: initialize smoke repository"
```

In any Discord channel, run:

```text
/add-project name:discordagent-smoke path:~/projects/discordagent-smoke
```

Expected outcome: The bot creates a category named `discordagent-smoke` with a private `#agent` channel and posts a welcome message.

## 10. Send your first task

In the project's `#agent` channel, send a normal message:

```text
Add a hello.txt file with the text "Hello from Discord Agent" and verify the file exists.
```

## 11. Observe the result

Watch the thread that Discord Agent creates. You should see:

1. A task thread with a pinned control card showing status, provider, and branch.
2. Normalized output streaming in — text, status updates, file changes.
3. A completion message confirming the outcome and branch.
4. The file `hello.txt` exists on the worktree at the project path.

To confirm the worktree:

```bash
ls ~/projects/discordagent-smoke/hello.txt
git branch --list 'agent/codex/*'
```

## 12. Continue the task

Reply in the task thread with:

```text
Add a line to hello.txt with the current date and time.

Then check the thread for streaming output in the same provider session and worktree.

## 13. Cleanup

Remove the disposable project:

```text
/remove-project name:discordagent-smoke
```

Stop the bot with Ctrl+C. The task thread, branch, and worktree remain available for inspection.

## Next steps

- [Configure Claude](../how-to/providers/configure-claude.md) as an additional provider
- [Configure OpenCode](../how-to/providers/configure-opencode.md) for ACP-based agents
- [Manage settings](../how-to/README.md) for global and project configuration
- Read the [architecture overview](../explanation/architecture/provider-neutral-runtime.md) to understand the system design

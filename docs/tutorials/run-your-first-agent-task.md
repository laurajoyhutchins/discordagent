# Run your first agent task

This tutorial walks through installing Discord Agent, connecting Codex, registering a disposable repository, and running one successful task end to end.

## Prerequisites

- Node.js 22 or later
- Git
- A private Discord server where you have **Manage Server** permission
- Codex CLI installed on the machine that will host the bot

This tutorial uses Codex for one clear learning path. After completing it, see the [provider how-to guides](../how-to/providers/) for Claude and OpenCode.

## 1. Clone and install Discord Agent

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
cp .env.example .env
```

Run all remaining `npm` commands from this repository checkout.

## 2. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Open **General Information** and copy the **Application ID**. This becomes `DISCORD_CLIENT_ID`.
3. Open **Bot**. Newly created Discord applications normally include a bot user; create one if the portal presents that option.
4. Under **Token**, reset and copy the bot token. This becomes `DISCORD_TOKEN`. Store it as a secret.
5. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
6. In Discord, enable Developer Mode and copy:
   - your private server ID for `DISCORD_GUILD_ID`;
   - at least one trusted role ID for `AUTHORIZED_ROLE_IDS`;
   - your own user ID for `AUTHORIZED_USER_ID`.

## 3. Configure the required environment variables

Edit `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
AUTHORIZED_ROLE_IDS=your-authorized-role-id
AUTHORIZED_USER_ID=your-user-id
```

For a safer host, also restrict project registration to a directory you control:

```env
PROJECTS_BASE_DIR=/absolute/path/to/your/projects
```

See the [configuration reference](../reference/configuration.md) for all options.

## 4. Install the bot in your server

From the Discord Agent checkout, generate the least-privilege installation URL:

```bash
npm run discord:permissions
```

Open the printed URL, choose **Add to server**, select your private server, and authorize the application. Do not grant **Administrator**.

Expected outcome: the bot appears in the server member list. It remains offline until Discord Agent starts.

## 5. Authenticate Codex on the bot host

Complete Codex authentication locally on the machine running Discord Agent:

```bash
codex login --device-auth
```

Do not send the verification URL, one-time code, or provider credentials through Discord.

See [Configure Codex](../how-to/providers/configure-codex.md) for troubleshooting and alternate CLI-path configuration.

## 6. Run the preflight checks

Check the host before connecting to Discord:

```bash
npm run smoke:host
```

Resolve any reported missing variables, unwritable paths, or unavailable provider CLIs.

Register the application commands, then verify the Discord connection:

```bash
npm run register
npm run smoke:discord
```

Expected outcome: the Discord smoke check identifies the bot and guild and verifies the configured roles and registered commands.

## 7. Start Discord Agent

```bash
npm run dev
```

Expected outcome: the process acquires the instance lock, logs in to Discord, initializes SQLite, and creates or reconciles the private `#agent-chat` channel.

## 8. Select Codex

Open `#agent-chat` and select **Codex** in the provider setup controls. If the bot reports that Codex authentication is missing, recheck host-local authentication rather than posting credentials in Discord.

Expected outcome: the bot confirms Codex as the primary provider and activates the PM-style primary agent.

## 9. Create a disposable Git repository

In another terminal:

```bash
mkdir -p ~/projects/discordagent-smoke
cd ~/projects/discordagent-smoke
git init
git switch -c main
echo "# Discord Agent smoke test" > README.md
git add README.md
git commit -m "chore: initialize smoke repository"
pwd
```

Copy the absolute path printed by `pwd`. On PowerShell, use `(Get-Location).Path` instead.

In Discord, run `/add-project` and paste the literal absolute path. Do not use `~`, environment variables, or shell substitutions in the Discord command.

```text
/add-project name:discordagent-smoke path:/absolute/path/from-pwd
```

Expected outcome: Discord Agent creates a private project category with an `#agent` channel.

## 10. Send the first task

In the project's `#agent` channel, send:

```text
Add a hello.txt file containing "Hello from Discord Agent", verify the file exists, and report the verification result.
```

Discord Agent creates a task thread, an `agent/codex/...` branch, and a separate worktree before starting Codex.

## 11. Observe and verify the result

In the task thread, look for:

1. A task control card showing the objective, provider, status, and branch. It is pinned only when the optional `Pin Messages` capability is enabled.
2. Provider-neutral status, plan, command, and file-change events.
3. Any approval or user-input controls required by the provider.
4. A terminal result summarizing the outcome and verification.

From the original disposable repository, list its worktrees:

```bash
git -C /absolute/path/from-pwd worktree list
```

Find the entry whose branch is `agent/codex/...`, copy the worktree path from that output, and verify the generated file there:

```bash
cat /absolute/worktree/path/hello.txt
```

Do not expect `hello.txt` to appear in the original checkout; the task edits its isolated worktree.

## 12. Continue the same task

Reply in the task thread:

```text
Add a second line to hello.txt containing the current date and time, then verify both lines.
```

The continuation keeps the same durable task, Codex session, branch, and worktree.

## 13. Clean up

Inspect anything you want to retain before removing the project, because project removal deletes its Discord category and task threads.

In Discord:

```text
/remove-project name:discordagent-smoke
```

The project record is archived and its Discord channels are deleted. Historical SQLite records and task worktrees are preserved for inspection; `/remove-project` does not clean them from disk.

Stop the bot with Ctrl+C.

## Next steps

- [Configure Claude](../how-to/providers/configure-claude.md)
- [Configure OpenCode](../how-to/providers/configure-opencode.md)
- [Register a project](../how-to/projects/register-a-project.md)
- [Understand task isolation and Git worktrees](../explanation/architecture/task-isolation-and-git-worktrees.md)

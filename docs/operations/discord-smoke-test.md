# Discord Host Smoke Test

Use this procedure on the machine that will run Discord Agent. It deliberately keeps Discord and provider credentials on the local host; do not move `.env`, SQLite files, provider login state, or project worktrees into GitHub Actions.

## 1. Static verification

From a clean checkout of `main`:

```bash
npm ci
npm run check
```

Expected: all tests pass and TypeScript builds without errors.

## 2. Host preflight

Configure `.env`, then run:

```bash
npm run smoke:host
```

The preflight validates:

- required Discord environment variables and snowflake formats;
- the owner identity used for `#agent-chat` and Codex authentication;
- writable database, project, and worktree directories;
- Node.js, Git, Claude, Codex, and optional Roborev CLIs;
- SQLite native loading and every schema migration;
- the primary-agent usage reserve.

Resolve every failure before continuing. Warnings represent deliberately disabled optional behavior or a reduced safety posture.

## 3. Discord connectivity

Register commands once, then perform read-only Discord verification:

```bash
npm run register
npm run smoke:discord
```

This verifies that the bot token authenticates as `DISCORD_CLIENT_ID`, the bot can read `DISCORD_GUILD_ID`, every authorized role exists, and all expected guild commands are registered. The token and IDs are never printed.

## 4. Start the runtime

```bash
npm run build
npm start
```

Confirm the log contains:

```text
Instance lock acquired
Logged in as ...
Slash commands registered.
```

When Codex is enabled, also confirm that no `Codex App Server unavailable` warning appears. Confirm only one bot process is running.

## 5. Disposable project

Create a temporary Git repository under `PROJECTS_BASE_DIR`:

```bash
mkdir -p "$PROJECTS_BASE_DIR/discordagent-smoke"
cd "$PROJECTS_BASE_DIR/discordagent-smoke"
git init
git switch -c main
printf '# Discord Agent smoke test\n' > README.md
git add README.md
git commit -m 'chore: initialize smoke repository'
```

In Discord, register it with `/add-project`. Confirm that a project category and private `#agent` channel are created and visible only to the configured roles.

## 6. Claude vertical slice

In the project `#agent` channel, ask Claude to add a small text file and verify it.

Confirm:

1. one task thread is created;
2. the thread name reflects running and terminal state;
3. one `agent/claude/...` branch and one isolated worktree are created;
4. output streams into the task thread;
5. the task completes with a concise result and verification;
6. a reply in the thread continues the same provider session and worktree;
7. `/agents` shows the task and `/usage` remains exception-driven.

## 7. Codex vertical slice

Set the project provider to Codex. When authentication is required, run `/codex-auth login` as the configured owner and complete the device flow privately.

Confirm:

1. the device code is ephemeral and absent from ordinary logs and SQLite;
2. the pending request does not create a worktree before **Start task** is selected;
3. one `agent/codex/...` branch and worktree are created after confirmation;
4. plans, commands, file changes, approvals, questions, usage, and completion render correctly;
5. cancellation preserves the worktree and does not replay the turn.

## 8. Handoff and decisions

From a completed task thread, request the other provider.

Confirm that Discord asks for confirmation, creates a sibling thread after approval, starts a fresh provider session and worktree based on the committed source branch, and transfers only the bounded handoff summary. Exercise one button, select menu, and native poll; ambiguous or incomplete decisions must not authorize consequential work.

## 9. Restart recovery

Start a task that makes a harmless change, then stop the bot while the task is running. Restart it.

Confirm that:

- the task becomes `interrupted` rather than completed or failed;
- the branch and worktree remain intact;
- a checkpoint appears in the original thread;
- no provider turn is replayed automatically;
- a new explicit message resumes work.

## 10. Cleanup and evidence

Remove the disposable project with `/remove-project`. Preserve dirty worktrees until inspected; never force-remove them. Record the date, host commit SHA, Discord guild, tested Claude/Codex versions, task thread links, branch/worktree paths, and any deviations in the deployment notes.

A successful run establishes operational readiness for the tested host and guild. It does not authorize automatic merging, deployment, destructive cleanup, or use by untrusted Discord members.

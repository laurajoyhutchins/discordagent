# Setting Up Providers

## Claude

### Requirements

- [Claude Code](https://claude.ai) installed and authenticated on the bot host
- Run `claude` once locally to complete OAuth before starting the bot

### Configuration

Claude requires no special environment variables beyond the defaults. To override the model:

```env
CLAUDE_MODEL=sonnet
CLAUDE_TIMEOUT_MS=300000
```

To disable Claude and use only Codex:

```env
CLAUDE_ENABLED=false
```

### MCP servers

MCP servers defined in `~/.claude/settings.json` `mcpServers` are loaded automatically. Each named server becomes a selectable MCP profile in `/project-settings`. The `default` and `disabled` names are reserved:

- **default** — all non-reserved servers are included
- **disabled** — no servers are included
- Any other name — only that server is included

## Codex

### Requirements

- [Codex CLI](https://codex.ai) installed on the bot host
- The `codex` command must be available in PATH (or configured via `CODEX_CLI_PATH`)

### Authentication

Codex authentication is performed through the bot:

1. In `#agent-chat`, run `/codex-auth login`
2. On the bot host, run `codex login --device-auth`
3. Back in Discord, click **Check again**
4. If authentication succeeded, click **Start task**

The verification URL and one-time code are never displayed in Discord. Login state expires after 30 minutes if not completed.

### Configuration

```env
CODEX_ENABLED=true
CODEX_CLI_PATH=codex  # or /path/to/codex
CODEX_MODEL=gpt-5.6-luna
```

## Provider selection

### Global default

Set in `#agent-chat` via the setup prompt buttons or:

```
/provider codex
```

### Project override

In any project channel:

```
/provider claude
```

Or use `/project-settings` to change the provider in the settings panel.

## Verifying provider status

Use `/codex-auth status` to check Codex authentication. Use `/usage` in any channel to see rate-limit status and available capacity.

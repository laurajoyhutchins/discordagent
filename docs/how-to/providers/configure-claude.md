# How to configure Claude

Set up the Claude provider for task execution and primary-agent chat.

## Prerequisites

- [Claude Code](https://claude.ai) installed on the bot host
- Claude authenticated locally (run `claude` once to complete OAuth before starting the bot)

## Configuration

Claude requires no special environment variables beyond the defaults:

```env
CLAUDE_ENABLED=true
# Optional overrides:
CLAUDE_MODEL=sonnet
CLAUDE_TIMEOUT_MS=300000
```

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_ENABLED` | `true` | Set to `false` to disable Claude on a Codex-only host |
| `CLAUDE_MODEL` | SDK default | Default model alias or exact model ID |
| `CLAUDE_TIMEOUT_MS` | `900000` | Maximum Claude turn timeout in milliseconds |

### MCP servers

MCP servers defined in `~/.claude/settings.json` under `mcpServers` are loaded automatically. Each named server becomes a selectable MCP profile in `/project-settings`.

Reserved names:
- **default** — all non-reserved servers are included
- **disabled** — no servers are included
- Any other name — only that server is included

Project-level `.claude/settings.json` and `.claude/settings.local.json` are deliberately ignored.

## Verification

1. Start the bot.
2. In `#agent-chat`, the setup prompt should list Claude as an available option. Select it.
3. Send a task in a project channel and confirm the task thread shows Claude as the provider.

## Failure cases

| Problem | Resolution |
|---|---|
| Claude not listed in provider selection | Check `CLAUDE_ENABLED=true` and that `claude` CLI is found at startup |
| Task fails to start with Claude | Run `claude` once locally to complete OAuth |
| "Unsupported setting" error | Claude does not support `reasoningEffort` |

## Reference

- [Provider support reference](../../reference/provider-support.md)
- [Configuration reference](../../reference/configuration.md)
- [Settings precedence](../../explanation/architecture/provider-neutral-runtime.md)

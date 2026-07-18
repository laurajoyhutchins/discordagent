# Compatibility

## Node.js

- **Required:** Node.js 22 or later
- **Tested:** Node.js 22.x

## TypeScript

- **Target:** ES2022
- **Module:** ES2022 with bundler module resolution

## Discord.js

- **Version:** 14.x (^14.24.0)
- **Intents:** Guilds, GuildMembers, GuildMessages, MessageContent
- **Partials:** Message, Channel

## Git

- **Required:** Git must be installed and in PATH for task worktree isolation
- Git commands use `execFile` with `shell: false`

## Providers

### Claude

- **CLI:** [Claude Code](https://claude.ai)
- **SDK:** `@anthropic-ai/claude-agent-sdk` ^0.2.87
- **Authentication:** Local OAuth (host-side)
- **Settings:** User-level only; project/local settings ignored

### Codex

- **CLI:** [Codex CLI](https://codex.ai)
- **Transport:** Local App Server (JSON-RPC over stdio)
- **Authentication:** Device-code login via `/codex-auth`
- **Model aliases:** Provider-specific; use exact model IDs with `custom` parameter

### OpenCode

- **CLI:** [OpenCode CLI](https://opencode.ai)
- **Transport:** ACP v1 (Agent Client Protocol)
- **Authentication:** CLI-native; no Discord Agent involvement
- **Behavior:** Capability-dependent; session load/resume requires ACP support

## SQLite

- **Driver:** `better-sqlite3` ^12.4.1
- **Migrations:** Versioned, transactional, recorded in `schema_migrations`
- **Current schema version:** 9

## Operating system

- **Tested:** Linux, macOS, Windows (via Node.js cross-platform support)
- **Lock mechanism:** TCP port lock (`INSTANCE_LOCK_PORT`, default 47831)

# Discord Agent — Claude-specific guidance

The authoritative repository instructions for all coding agents, including Claude, live in [AGENTS.md](AGENTS.md). Read and follow `AGENTS.md` before making changes.

This file intentionally stays small so Claude does not receive a second, drifting copy of repository architecture, lifecycle, verification, or GitHub workflow rules.

## Claude-specific boundaries

- Claude task execution is implemented by `ClaudeProvider` under `src/agents/claude/` and crosses the generic runtime through the provider-neutral contracts in `src/agents/contracts.ts`.
- The PM-style Claude primary model must remain tool-disabled. It may converse and propose delegation, but it must not edit repositories or bypass `TaskCoordinator`.
- Claude settings must remain limited to the supported user-level setting source so repository content cannot weaken host policy.
- Provider credentials, device/authentication material, and session secrets remain host-local and must not be persisted in SQLite, logs, Discord output, commits, or documentation.

For shared architecture, security rules, task lifecycle ordering, testing expectations, documentation placement, and GitHub operating procedure, update `AGENTS.md` rather than duplicating them here.

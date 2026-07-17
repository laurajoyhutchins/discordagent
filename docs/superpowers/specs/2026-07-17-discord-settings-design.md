# Discord-Managed Agent Settings Design

**Date:** 2026-07-17
**Status:** Approved design
**Scope:** Global agent behavior and project operational settings managed from Discord

## Goal

Allow the authorized user to manage agent behavior and project operational settings without leaving Discord, while preserving provider/session immutability, worktree safety, provider-neutral contracts, and host-controlled security boundaries.

## Non-goals

- Exposing Discord tokens, provider credentials, API keys, device codes, or arbitrary secrets.
- Allowing Discord to change executable paths, database paths, worktree roots, authorization IDs, or Discord identity settings.
- Accepting arbitrary MCP server definitions or command strings from Discord.
- Changing the provider, session, model context, worktree, or safety policy of a task already in progress.
- Replacing the authenticated provider or replaying a partially executed turn after a settings change.

## Settings scope

Settings are resolved with this precedence:

```text
host environment defaults
        ↓
global Discord settings
        ↓
project Discord settings
        ↓
one-message override
```

Global settings:

- default provider;
- Claude default model;
- Codex default model;
- primary-agent model;
- Claude turn timeout;
- usage reserve.

Project settings:

- default provider;
- Claude model override;
- Codex model override;
- base branch;
- MCP profile;
- Roborev enabled state and channel identity.

Task-scoped settings:

- one-message model override;
- resolved model;
- resolved timeout;
- resolved MCP profile;
- reserved provider-neutral approval-profile field for future policy work, not user-editable in this release.

The coordinator resolves and snapshots effective task settings before creating the provider session. Continuations reuse the task snapshot. A project setting therefore applies to new tasks rather than silently changing an active provider session.

## Architecture

### Settings service

Add a typed `SettingsService` between Discord commands and repositories. It owns:

- global and project setting reads and writes;
- precedence resolution;
- validation and normalization;
- provider-availability checks for provider changes;
- authorization decisions supplied by the command boundary;
- notification of primary-agent reconfiguration.

Command handlers must not write SQLite directly.

The existing `runtime_settings` table remains the global persistence mechanism. Its generic storage is hidden behind typed methods such as `getDefaultProvider`, `setDefaultProvider`, `getDefaultModel`, `setPrimaryAgentModel`, `getClaudeTimeout`, and `setUsageReserve`.

The project settings repository continues to treat existing provider, model, and base-branch fields as canonical. A typed project-settings table or equivalent repository-backed storage holds new settings such as MCP profile. No command may maintain a second in-memory project configuration cache.

Add a task settings snapshot field through a migration. `TaskRecord` exposes the validated `AgentTaskSettings` value rather than raw JSON.

```ts
interface AgentTaskSettings {
  model?: string;
  timeoutMs?: number;
  mcpProfile?: string;
  approvalProfile?: string;
}
```

The shared contract contains only provider-neutral scalar values and profile names. Provider SDK types and MCP server definitions remain inside provider-specific modules.

### Provider integration

The coordinator passes the task snapshot through `StartTaskInput` and `ContinueTaskInput`.

`ClaudeProvider` uses the snapshot for model, timeout, and the resolved allowlisted MCP profile. `CodexProvider` uses the resolved model and ignores unsupported fields. Provider defaults are resolved at task start, so changing a global default does not require replacing the coding-provider instance.

The primary-agent activator reads the latest global provider/model settings. Updating either setting explicitly rebuilds the PM model and registry entry without interrupting coding tasks.

### Task lifecycle

Before worktree creation, the coordinator:

1. resolves provider and effective settings;
2. verifies provider availability;
3. validates the configured base branch against the project repository;
4. performs usage admission;
5. creates the Discord thread and Git worktree;
6. persists task, worktree, reservation, and settings snapshot transactionally.

The existing required startup ordering remains intact after the settings snapshot is added. Active tasks retain their provider, session, branch, worktree, and task settings.

## Discord UI

Add `/settings` in `#agent-chat` for global and PM settings. Add `/project-settings` in a project `#agent` channel for project settings. Existing `/provider` and `/model` commands remain shortcuts.

Use select menus for providers, models, and MCP profiles. Use modals for timeout, usage reserve, and base branch. Use confirmation buttons for Roborev channel creation/removal. Replies are ephemeral where the result is private or administrative.

Component IDs are scope- and action-specific, stay within Discord's custom-ID length limit, and are revalidated against the clicking member and current project state on every interaction. Settings commands are rejected in task threads because task context is immutable.

Global settings and MCP profile changes require `AUTHORIZED_USER_ID`. Project settings require the existing authorized role. Provider changes must pass `ProviderRegistry` availability checks before persistence.

### Roborev changes

Roborev enable/disable is a compensating operation because Discord channel APIs and SQLite cannot share a transaction:

1. validate authorization and current project state;
2. create or remove the Roborev channel;
3. persist the resulting channel identity/state only after the Discord operation succeeds;
4. if persistence fails after creation, report the inconsistency and retain the channel for recovery;
5. if deletion fails, retain the enabled state and report the failure.

No webhook or webhook credential is introduced.

### MCP profiles

The host supplies a named allowlist of profiles built from preconfigured user-level Claude MCP servers. Discord can select a profile or disable MCP use, but cannot create or edit server commands, URLs, environment variables, or credentials.

## Validation and failure behavior

- Invalid values are rejected before SQLite writes.
- Timeout must be a bounded positive duration.
- Usage reserve must be between 0 and 50 percent.
- Base branch must be non-empty and resolvable before a task uses it.
- Model values must be non-empty when set; clearing a value restores the host/provider default.
- MCP profiles must be in the host-provided allowlist.
- Unavailable providers cannot become global or project defaults.
- A setting change reports whether it applies immediately, to new tasks, or after PM reconfiguration.
- Settings failures never trigger provider replay or automatic task retry.

## Testing

Add focused tests for:

- global and project settings repository round trips;
- defaults, clearing values, precedence, and validation ranges;
- task settings persistence and continuation snapshot retention;
- role and owner authorization for every command and component;
- modal/select interaction handling and stale-state errors;
- provider options receiving resolved settings;
- PM model/provider reconfiguration;
- base-branch validation failures;
- Roborev create/delete/persistence failure compensation;
- migration of existing provider, model, and base-branch values.

Before implementation is considered complete, run:

```text
npm test
npm run build
git diff --check
```

## Rollout

Implement persistence and resolution first, then expose global settings, then project settings, then Roborev/MCP controls. Existing environment values remain the fallback, so upgrading does not require immediate Discord configuration. Existing `/provider` and `/model` behavior must remain compatible throughout the rollout.

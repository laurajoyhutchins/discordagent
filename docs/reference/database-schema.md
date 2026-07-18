# Database Schema

The SQLite database is created automatically on first run. The current schema version is **9**. Migrations are ordered, transactional, and recorded in `schema_migrations`.

Migration 9 rebuilds provider-constrained tables so existing installations accept `opencode` alongside `claude` and `codex`. The migration preserves child rows, runs `foreign_key_check` before commit, and restores foreign-key enforcement.

## Core tables

### `projects`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | Project UUID |
| `name` | TEXT (UNIQUE, NOCASE) | Project name |
| `working_directory` | TEXT | Absolute repository path |
| `category_id` | TEXT | Discord category ID |
| `agent_channel_id` | TEXT (UNIQUE) | Project task-creation channel |
| `default_provider` | TEXT | `claude`, `codex`, or `opencode` |
| `models_json` | TEXT | Provider-keyed model overrides |
| `reasoning_efforts_json` | TEXT | Provider-keyed reasoning overrides |
| `base_branch` | TEXT | Optional worktree base branch |
| `roborev_channel_id` | TEXT | Optional review channel |
| `legacy_metadata_json` | TEXT | One-time import metadata |
| `archived_at` | INTEGER | Null while active |
| `created_at`, `updated_at` | INTEGER | Unix timestamps |

### `tasks`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | Durable task UUID |
| `project_id` | TEXT (FK) | Project identity |
| `provider` | TEXT | Immutable provider identity |
| `status` | TEXT | `created`, `starting`, `running`, `waiting_for_user`, or terminal state |
| `channel_id` | TEXT | Parent Discord channel |
| `thread_id` | TEXT (UNIQUE) | Discord task thread |
| `objective` | TEXT | Redacted task objective |
| `settings_json` | TEXT | Immutable task-settings snapshot |
| `started_at`, `completed_at` | INTEGER | Lifecycle timestamps |
| `created_at`, `updated_at` | INTEGER | Unix timestamps |

### `worktrees`

Stores the one-to-one task worktree, repository path, worktree path, branch, base ref, and removal timestamp. Dirty worktrees are preserved by runtime policy.

### `provider_sessions`

Stores one immutable provider/session identity per task. `(provider, session_id)` is unique.

### `task_events`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment sequence |
| `task_id` | TEXT (FK) | Durable task |
| `dedupe_key` | TEXT | Optional task-scoped idempotency key |
| `type` | TEXT | Normalized event type |
| `payload_json` | TEXT | Redacted serialized event payload |
| `created_at` | INTEGER | Unix timestamp |

### `task_results`

Stores terminal outcome, summary, verification items, unresolved items, usage payload, and completion timestamp for each task.

### `task_control_cards`

Stores the durable Discord control-card projection: task ID, message ID, pin state (`unknown`, `pinned`, `not_pinned`, or `failed`), and update timestamp.

## Settings tables

### `runtime_settings`

Key/value settings for the global provider, provider models, PM model, Claude timeout, usage reserve, reasoning effort, primary-channel identity, and onboarding metadata.

### `project_settings`

Project-keyed JSON settings that do not belong in canonical project columns. The current service uses this table for the selected Claude MCP profile.

## Conversation and memory

### `messages` and `messages_fts`

The complete PM conversation journal. `messages_fts` is an FTS5 external-content index synchronized by insert, update, and delete triggers.

### `memory_records` and `memory_revisions`

Structured namespace/key memory with provenance, confidence, read-only protection, archival state, and revision history.

## Usage and authentication

### `usage_snapshots`

Provider usage/rate-limit snapshots keyed by provider and window type.

### `usage_reservations`

Pre-task and task-attached capacity reservations with task class, estimate range, confidence, status, and actual cost.

### `usage_observations`

Historical provider/task-class actual costs used to calibrate future estimates.

### `pending_auth_flows`

Temporary authentication-flow state. It is currently used for Codex device login; provider identity remains constrained to the supported provider set.

## Discord interactions

### `interactions`

Durable approval and question state keyed by Discord interaction ID.

## Legacy import tracking

### `legacy_imports`

Records one-time JSON project imports so startup does not duplicate migrated projects.

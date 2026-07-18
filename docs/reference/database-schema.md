# Database Schema

The SQLite database is created automatically on first run. Migrations are versioned and run transactionally. The current schema version is 8.

## Tables

### `projects`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `name` | TEXT (UNIQUE) | Project name |
| `agent_channel_id` | TEXT | Discord channel ID for task creation |
| `roborev_channel_id` | TEXT | Discord channel ID for review posts |
| `working_directory` | TEXT | Absolute path to repository |
| `default_provider` | TEXT | `claude` or `codex` |
| `models_json` | TEXT | JSON with per-provider model keys |
| `reasoning_efforts_json` | TEXT | JSON with per-provider effort keys |
| `base_branch` | TEXT | Git branch for worktree base |
| `category_id` | TEXT | Discord category channel ID |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |
| `archived_at` | INTEGER | Null when active |

### `tasks`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `project_name` | TEXT | FK to projects |
| `provider` | TEXT | Immutable provider identity |
| `channel_id` | TEXT | Discord channel ID |
| `thread_id` | TEXT (UNIQUE) | Discord thread ID |
| `objective` | TEXT | Redacted task prompt |
| `status` | TEXT | Current task status |
| `settings_json` | TEXT | Immutable settings snapshot |
| `provider_session_id` | TEXT | Current provider session ID |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |
| `completed_at` | INTEGER | Null when active |

### `worktrees`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `task_id` | TEXT (UNIQUE, FK) | FK to tasks |
| `repository_path` | TEXT | Absolute repository path |
| `worktree_path` | TEXT | Absolute worktree path |
| `branch_name` | TEXT | Git branch name |
| `base_ref` | TEXT | Base reference for the branch |
| `removed_at` | INTEGER | Null when present |

### `provider_sessions`

| Column | Type | Description |
|---|---|---|
| `provider` | TEXT | Provider identity |
| `session_id` | TEXT | Provider session ID |
| `task_id` | TEXT (FK) | FK to tasks |
| `created_at` | INTEGER | Unix timestamp |

Unique constraint: `(provider, session_id)`

### `task_events`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment |
| `task_id` | TEXT (FK) | FK to tasks |
| `event_json` | TEXT | Serialized AgentEvent |
| `dedupe_key` | TEXT | Optional deduplication key |
| `created_at` | INTEGER | Unix timestamp |

### `task_results`

| Column | Type | Description |
|---|---|---|
| `task_id` | TEXT (PK, FK) | FK to tasks |
| `result_json` | TEXT | Serialized TaskResult |
| `created_at` | INTEGER | Unix timestamp |

### `task_control_cards`

| Column | Type | Description |
|---|---|---|
| `task_id` | TEXT (PK, FK) | FK to tasks |
| `message_id` | TEXT | Discord message ID |
| `pin_state` | TEXT | `unknown`, `pinned`, `not_pinned`, `failed` |
| `updated_at` | INTEGER | Unix timestamp |

### `runtime_settings`

| Column | Type | Description |
|---|---|---|
| `key` | TEXT (PK) | Setting key |
| `value` | TEXT | Setting value |
| `updated_at` | INTEGER | Unix timestamp |

### `project_settings`

| Column | Type | Description |
|---|---|---|
| `project_id` | TEXT (FK) | FK to projects |
| `key` | TEXT | Setting key |
| `value_json` | TEXT | JSON value |
| `updated_at` | INTEGER | Unix timestamp |

Primary key: `(project_id, key)`

### `messages` and `messages_fts`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (PK) | Message ID |
| `channel_id` | TEXT | Discord channel ID |
| `author_id` | TEXT | Discord user ID |
| `role` | TEXT | `user` or `assistant` |
| `content` | TEXT | Redacted message content |
| `created_at` | INTEGER | Unix timestamp |

FTS5 virtual table `messages_fts` is synchronized via insert/update/delete triggers.

### `memory_records` and `memory_revisions`

Structured memory records with namespace/key/value, revision history, and read-only locking.

### `usage_snapshots` and `usage_reservations`

Provider rate-limit snapshots and task cost reservations for admission control.

### `pending_auth_flows`

Temporary authentication flow state for Codex device login.

### `interactions`

Discord interaction state for approvals and user questions, keyed by custom ID.

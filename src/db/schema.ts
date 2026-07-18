import type { Migration } from './migrations.js';

const PROVIDER_CHECK = "CHECK (default_provider IN ('claude', 'codex', 'opencode'))";
const TASK_PROVIDER_CHECK = "CHECK (provider IN ('claude', 'codex', 'opencode'))";
const TASK_STATUS_CHECK = `CHECK (status IN (
  'created', 'starting', 'running', 'waiting_for_user',
  'completed', 'failed', 'cancelled', 'interrupted'
))`;

export const SCHEMA_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create operational store',
    statements: [
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        working_directory TEXT NOT NULL,
        category_id TEXT NOT NULL,
        agent_channel_id TEXT NOT NULL UNIQUE,
        default_provider TEXT NOT NULL DEFAULT 'claude' ${PROVIDER_CHECK},
        models_json TEXT NOT NULL DEFAULT '{}',
        base_branch TEXT,
        roborev_channel_id TEXT,
        legacy_metadata_json TEXT,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        status TEXT NOT NULL ${TASK_STATUS_CHECK},
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        objective TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      )`,
      'CREATE INDEX tasks_project_status_idx ON tasks(project_id, status)',

      `CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        repository_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch_name TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        removed_at INTEGER,
        UNIQUE(repository_path, branch_name)
      )`,

      `CREATE TABLE provider_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(provider, session_id)
      )`,

      `CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        dedupe_key TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(task_id, dedupe_key)
      )`,
      'CREATE INDEX task_events_task_created_idx ON task_events(task_id, created_at, id)',

      `CREATE TABLE task_results (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled', 'interrupted')),
        summary TEXT NOT NULL,
        verification_json TEXT NOT NULL DEFAULT '[]',
        unresolved_json TEXT NOT NULL DEFAULT '[]',
        usage_json TEXT,
        completed_at INTEGER NOT NULL
      )`,

      `CREATE TABLE messages (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        thread_id TEXT,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        author_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'agent')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edited_at INTEGER
      )`,
      'CREATE INDEX messages_channel_created_idx ON messages(channel_id, created_at)',
      'CREATE INDEX messages_thread_created_idx ON messages(thread_id, created_at)',

      `CREATE VIRTUAL TABLE messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='row_id',
        tokenize='unicode61'
      )`,
      `CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.row_id, new.content);
      END`,
      `CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.row_id, old.content);
      END`,
      `CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.row_id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.row_id, new.content);
      END`,

      `CREATE TABLE interactions (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        discord_interaction_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'expired', 'cancelled')),
        requested_by TEXT,
        resolved_by TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      )`,

      `CREATE TABLE memory_records (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        memory_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
        read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(namespace, memory_key)
      )`,

      `CREATE TABLE memory_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
        previous_value_json TEXT,
        next_value_json TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        created_at INTEGER NOT NULL
      )`,

      `CREATE TABLE usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        window_type TEXT NOT NULL,
        utilization REAL,
        remaining REAL,
        resets_at INTEGER,
        payload_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL
      )`,
      'CREATE INDEX usage_snapshots_provider_time_idx ON usage_snapshots(provider, captured_at)',

      `CREATE TABLE usage_reservations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        estimated_low REAL NOT NULL CHECK (estimated_low >= 0),
        estimated_high REAL NOT NULL CHECK (estimated_high >= estimated_low),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
        created_at INTEGER NOT NULL,
        released_at INTEGER
      )`,

      `CREATE TABLE pending_auth_flows (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        requested_by TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'checking', 'authentication_required', 'awaiting_user',
          'verifying', 'failed', 'cancelled'
        )),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    name: 'track one-time legacy project imports',
    statements: [
      `CREATE TABLE legacy_imports (
        source_path TEXT PRIMARY KEY,
        imported_at INTEGER NOT NULL,
        projects_imported INTEGER NOT NULL CHECK (projects_imported >= 0),
        projects_skipped INTEGER NOT NULL CHECK (projects_skipped >= 0)
      )`,
    ],
  },
  {
    version: 3,
    name: 'support usage admission holds and calibration',
    statements: [
      `CREATE TABLE usage_reservations_new (
        id TEXT PRIMARY KEY,
        task_id TEXT UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        task_class TEXT NOT NULL DEFAULT 'contained_feature',
        estimated_low REAL NOT NULL CHECK (estimated_low >= 0),
        estimated_high REAL NOT NULL CHECK (estimated_high >= estimated_low),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
        actual_cost REAL,
        created_at INTEGER NOT NULL,
        released_at INTEGER
      )`,
      `INSERT INTO usage_reservations_new
        (id, task_id, provider, estimated_low, estimated_high, confidence, status, created_at, released_at)
        SELECT id, task_id, provider, estimated_low, estimated_high, confidence, status, created_at, released_at
        FROM usage_reservations`,
      `DROP TABLE usage_reservations`,
      `ALTER TABLE usage_reservations_new RENAME TO usage_reservations`,
      `CREATE INDEX usage_reservations_provider_status_idx ON usage_reservations(provider, status)`,
      `CREATE TABLE usage_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        task_class TEXT NOT NULL,
        actual_cost REAL NOT NULL CHECK (actual_cost >= 0),
        token_count INTEGER,
        duration_ms INTEGER,
        recorded_at INTEGER NOT NULL
      )`,
      `CREATE INDEX usage_observations_class_idx ON usage_observations(provider, task_class, recorded_at)`,
    ],
  },
  {
    version: 4,
    name: 'allow repeated task usage reservations',
    statements: [
      `CREATE TABLE usage_reservations_v4 (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        task_class TEXT NOT NULL DEFAULT 'contained_feature',
        estimated_low REAL NOT NULL CHECK (estimated_low >= 0),
        estimated_high REAL NOT NULL CHECK (estimated_high >= estimated_low),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
        actual_cost REAL,
        created_at INTEGER NOT NULL,
        released_at INTEGER
      )`,
      `INSERT INTO usage_reservations_v4
        (id, task_id, provider, task_class, estimated_low, estimated_high, confidence, status, actual_cost, created_at, released_at)
        SELECT id, task_id, provider, task_class, estimated_low, estimated_high, confidence, status, actual_cost, created_at, released_at
        FROM usage_reservations`,
      `DROP TABLE usage_reservations`,
      `ALTER TABLE usage_reservations_v4 RENAME TO usage_reservations`,
      `CREATE INDEX usage_reservations_provider_status_idx ON usage_reservations(provider, status)`,
      `CREATE INDEX usage_reservations_task_status_idx ON usage_reservations(task_id, status, created_at)`,
    ],
  },
  {
    version: 5,
    name: 'add global runtime settings',
    statements: [
      `CREATE TABLE runtime_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 6,
    name: 'add project reasoning-effort settings',
    statements: [
      `ALTER TABLE projects ADD COLUMN reasoning_efforts_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    version: 7,
    name: 'add project settings and task snapshots',
    statements: [
      `ALTER TABLE tasks ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'`,
      `CREATE TABLE project_settings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, key)
      )`,
    ],
  },
  {
    version: 8,
    name: 'persist Discord task control-card projections',
    statements: [
      `CREATE TABLE task_control_cards (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        pin_state TEXT NOT NULL CHECK (pin_state IN ('unknown', 'pinned', 'not_pinned', 'failed')),
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX task_control_cards_message_idx ON task_control_cards(message_id)',
    ],
  },
  {
    version: 9,
    name: 'allow OpenCode in provider-constrained tables',
    disableForeignKeys: true,
    statements: [
      `CREATE TABLE projects_v9 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        working_directory TEXT NOT NULL,
        category_id TEXT NOT NULL,
        agent_channel_id TEXT NOT NULL UNIQUE,
        default_provider TEXT NOT NULL DEFAULT 'claude' ${PROVIDER_CHECK},
        models_json TEXT NOT NULL DEFAULT '{}',
        base_branch TEXT,
        roborev_channel_id TEXT,
        legacy_metadata_json TEXT,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        reasoning_efforts_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `INSERT INTO projects_v9 (
        id, name, working_directory, category_id, agent_channel_id,
        default_provider, models_json, base_branch, roborev_channel_id,
        legacy_metadata_json, archived_at, created_at, updated_at, reasoning_efforts_json
      ) SELECT
        id, name, working_directory, category_id, agent_channel_id,
        default_provider, models_json, base_branch, roborev_channel_id,
        legacy_metadata_json, archived_at, created_at, updated_at, reasoning_efforts_json
      FROM projects`,
      'DROP TABLE projects',
      'ALTER TABLE projects_v9 RENAME TO projects',

      `CREATE TABLE tasks_v9 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        status TEXT NOT NULL ${TASK_STATUS_CHECK},
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        objective TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        settings_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `INSERT INTO tasks_v9 (
        id, project_id, provider, status, channel_id, thread_id, objective,
        created_at, updated_at, started_at, completed_at, settings_json
      ) SELECT
        id, project_id, provider, status, channel_id, thread_id, objective,
        created_at, updated_at, started_at, completed_at, settings_json
      FROM tasks`,
      'DROP TABLE tasks',
      'ALTER TABLE tasks_v9 RENAME TO tasks',
      'CREATE INDEX tasks_project_status_idx ON tasks(project_id, status)',

      `CREATE TABLE provider_sessions_v9 (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(provider, session_id)
      )`,
      `INSERT INTO provider_sessions_v9
        (id, task_id, provider, session_id, created_at, updated_at)
        SELECT id, task_id, provider, session_id, created_at, updated_at FROM provider_sessions`,
      'DROP TABLE provider_sessions',
      'ALTER TABLE provider_sessions_v9 RENAME TO provider_sessions',

      `CREATE TABLE usage_snapshots_v9 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        window_type TEXT NOT NULL,
        utilization REAL,
        remaining REAL,
        resets_at INTEGER,
        payload_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL
      )`,
      `INSERT INTO usage_snapshots_v9
        (id, provider, window_type, utilization, remaining, resets_at, payload_json, captured_at)
        SELECT id, provider, window_type, utilization, remaining, resets_at, payload_json, captured_at
        FROM usage_snapshots`,
      'DROP TABLE usage_snapshots',
      'ALTER TABLE usage_snapshots_v9 RENAME TO usage_snapshots',
      'CREATE INDEX usage_snapshots_provider_time_idx ON usage_snapshots(provider, captured_at)',

      `CREATE TABLE usage_reservations_v9 (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        task_class TEXT NOT NULL DEFAULT 'contained_feature',
        estimated_low REAL NOT NULL CHECK (estimated_low >= 0),
        estimated_high REAL NOT NULL CHECK (estimated_high >= estimated_low),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
        actual_cost REAL,
        created_at INTEGER NOT NULL,
        released_at INTEGER
      )`,
      `INSERT INTO usage_reservations_v9
        (id, task_id, provider, task_class, estimated_low, estimated_high,
         confidence, status, actual_cost, created_at, released_at)
        SELECT id, task_id, provider, task_class, estimated_low, estimated_high,
         confidence, status, actual_cost, created_at, released_at
        FROM usage_reservations`,
      'DROP TABLE usage_reservations',
      'ALTER TABLE usage_reservations_v9 RENAME TO usage_reservations',
      'CREATE INDEX usage_reservations_provider_status_idx ON usage_reservations(provider, status)',
      'CREATE INDEX usage_reservations_task_status_idx ON usage_reservations(task_id, status, created_at)',

      `CREATE TABLE pending_auth_flows_v9 (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        requested_by TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'checking', 'authentication_required', 'awaiting_user',
          'verifying', 'failed', 'cancelled'
        )),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO pending_auth_flows_v9
        (id, provider, requested_by, state, created_at, expires_at, updated_at)
        SELECT id, provider, requested_by, state, created_at, expires_at, updated_at
        FROM pending_auth_flows`,
      'DROP TABLE pending_auth_flows',
      'ALTER TABLE pending_auth_flows_v9 RENAME TO pending_auth_flows',

      `CREATE TABLE usage_observations_v9 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL ${TASK_PROVIDER_CHECK},
        task_class TEXT NOT NULL,
        actual_cost REAL NOT NULL CHECK (actual_cost >= 0),
        token_count INTEGER,
        duration_ms INTEGER,
        recorded_at INTEGER NOT NULL
      )`,
      `INSERT INTO usage_observations_v9
        (id, provider, task_class, actual_cost, token_count, duration_ms, recorded_at)
        SELECT id, provider, task_class, actual_cost, token_count, duration_ms, recorded_at
        FROM usage_observations`,
      'DROP TABLE usage_observations',
      'ALTER TABLE usage_observations_v9 RENAME TO usage_observations',
      'CREATE INDEX usage_observations_class_idx ON usage_observations(provider, task_class, recorded_at)',
    ],
  },
] as const;

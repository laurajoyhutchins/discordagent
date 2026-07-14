import type { Migration } from './migrations.js';

const PROVIDER_CHECK = "CHECK (default_provider IN ('claude', 'codex'))";
const TASK_PROVIDER_CHECK = "CHECK (provider IN ('claude', 'codex'))";
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
] as const;

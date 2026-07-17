import type { Migration } from './migrations.js';

export const FACTORY_FLOOR_MIGRATION: Migration = {
  version: 5,
  name: 'bind Factory Floor runs to Discord threads',
  statements: [
    `CREATE TABLE factory_floor_runs (
      run_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      repository TEXT NOT NULL,
      objective TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      status_message_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'accepted', 'queued', 'running', 'completed',
        'failed', 'cancelled', 'rejected'
      )),
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      terminal_at INTEGER
    )`,
    `CREATE INDEX factory_floor_runs_active_idx
      ON factory_floor_runs(terminal_at, updated_at)`,
    `CREATE INDEX factory_floor_runs_project_idx
      ON factory_floor_runs(project_name, created_at)`,
  ],
};

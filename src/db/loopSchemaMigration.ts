import type { Migration } from './migrations.js';

export const LOOP_SCHEMA_MIGRATION: Migration = {
  version: 10,
  name: 'persist scheduled loop lifecycle',
  statements: [
    `CREATE TABLE scheduled_loops (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      interval_ms INTEGER NOT NULL CHECK (interval_ms > 0),
      iteration INTEGER NOT NULL DEFAULT 0 CHECK (iteration >= 0),
      next_run_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('active', 'running', 'stopped', 'terminal')),
      started_by TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      stopped_at INTEGER,
      stop_reason TEXT
    )`,
    `CREATE UNIQUE INDEX scheduled_loops_active_channel_idx
      ON scheduled_loops(channel_id)
      WHERE status IN ('active', 'running')`,
    `CREATE INDEX scheduled_loops_status_due_idx
      ON scheduled_loops(status, next_run_at, started_at)`,
    `CREATE INDEX scheduled_loops_project_status_idx
      ON scheduled_loops(project_id, status, started_at)`,
  ],
};

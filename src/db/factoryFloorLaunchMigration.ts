import type { Migration } from './migrations.js';

export const FACTORY_FLOOR_LAUNCH_MIGRATION: Migration = {
  version: 12,
  name: 'add trusted Factory Floor Activity launch state',
  statements: [
    `CREATE TABLE factory_floor_launch_states (
      state_id TEXT PRIMARY KEY,
      interaction_id TEXT NOT NULL UNIQUE,
      application_id TEXT NOT NULL,
      installation_type TEXT NOT NULL CHECK (installation_type = 'guild'),
      installation_owner_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT,
      principal_id TEXT NOT NULL,
      local_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      factory_floor_project_id TEXT NOT NULL,
      surface_id TEXT,
      run_id TEXT,
      context_kind TEXT NOT NULL CHECK (context_kind IN ('project', 'run')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      CHECK (expires_at > created_at),
      CHECK (
        (context_kind = 'project' AND surface_id IS NULL AND run_id IS NULL) OR
        (context_kind = 'run' AND surface_id IS NOT NULL AND run_id IS NOT NULL)
      ),
      CHECK (consumed_at IS NULL OR invalidated_at IS NULL),
      FOREIGN KEY(local_project_id, surface_id)
        REFERENCES factory_floor_surface_bindings(local_project_id, id),
      FOREIGN KEY(run_id)
        REFERENCES factory_floor_run_bindings(run_id)
    )`,
    `CREATE INDEX factory_floor_launch_pending_context_idx
      ON factory_floor_launch_states(
        application_id, guild_id, channel_id, thread_id,
        principal_id, expires_at, created_at
      )
      WHERE consumed_at IS NULL AND invalidated_at IS NULL`,
    `CREATE INDEX factory_floor_launch_cleanup_idx
      ON factory_floor_launch_states(expires_at, consumed_at, invalidated_at)`,
  ],
};

export const FACTORY_FLOOR_BINDINGS_MIGRATION = {
  version: 10,
  name: 'add Factory Floor adapter bindings',
  statements: [
    `CREATE TABLE factory_floor_project_bindings (
      local_project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      factory_floor_project_id TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      retired_at INTEGER,
      UNIQUE(local_project_id, guild_id)
    )`,
    `CREATE INDEX factory_floor_project_bindings_active_idx
      ON factory_floor_project_bindings(retired_at, updated_at)`,

    `CREATE TABLE factory_floor_surface_bindings (
      id TEXT PRIMARY KEY,
      local_project_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT,
      message_id TEXT,
      activity_instance_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      retired_at INTEGER,
      CHECK (
        thread_id IS NOT NULL OR
        message_id IS NOT NULL OR
        activity_instance_id IS NOT NULL
      ),
      UNIQUE(local_project_id, id),
      FOREIGN KEY(local_project_id, guild_id)
        REFERENCES factory_floor_project_bindings(local_project_id, guild_id)
        ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX factory_floor_surface_thread_idx
      ON factory_floor_surface_bindings(guild_id, channel_id, thread_id)
      WHERE thread_id IS NOT NULL`,
    `CREATE UNIQUE INDEX factory_floor_surface_message_idx
      ON factory_floor_surface_bindings(message_id)
      WHERE message_id IS NOT NULL`,
    `CREATE UNIQUE INDEX factory_floor_surface_activity_idx
      ON factory_floor_surface_bindings(activity_instance_id)
      WHERE activity_instance_id IS NOT NULL`,
    `CREATE INDEX factory_floor_surface_project_active_idx
      ON factory_floor_surface_bindings(local_project_id, retired_at, updated_at)`,

    `CREATE TABLE factory_floor_run_bindings (
      run_id TEXT PRIMARY KEY,
      local_project_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      retired_at INTEGER,
      FOREIGN KEY(local_project_id, surface_id)
        REFERENCES factory_floor_surface_bindings(local_project_id, id)
        ON DELETE CASCADE
    )`,
    `CREATE INDEX factory_floor_run_project_active_idx
      ON factory_floor_run_bindings(local_project_id, retired_at, updated_at)`,
    `CREATE INDEX factory_floor_run_surface_idx
      ON factory_floor_run_bindings(surface_id)`,
    `CREATE UNIQUE INDEX factory_floor_run_active_surface_idx
      ON factory_floor_run_bindings(surface_id)
      WHERE retired_at IS NULL`,

    `CREATE TRIGGER factory_floor_retire_archived_project_bindings
      AFTER UPDATE OF archived_at ON projects
      WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL
      BEGIN
        UPDATE factory_floor_run_bindings
        SET retired_at = NEW.archived_at, updated_at = NEW.archived_at
        WHERE local_project_id = NEW.id AND retired_at IS NULL;
        UPDATE factory_floor_surface_bindings
        SET retired_at = NEW.archived_at, updated_at = NEW.archived_at
        WHERE local_project_id = NEW.id AND retired_at IS NULL;
        UPDATE factory_floor_project_bindings
        SET retired_at = NEW.archived_at, updated_at = NEW.archived_at
        WHERE local_project_id = NEW.id AND retired_at IS NULL;
      END`,

    `CREATE TABLE factory_floor_service_nonces (
      key_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      consumed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(key_id, nonce)
    )`,
    `CREATE INDEX factory_floor_service_nonces_expiry_idx
      ON factory_floor_service_nonces(expires_at)`,
  ],
} as const;

import type { Migration } from './migrations.js';

export const FACTORY_FLOOR_OAUTH_MIGRATION: Migration = {
  version: 13,
  name: 'add Factory Floor Activity OAuth PKCE state',
  statements: [
    `CREATE TABLE factory_floor_oauth_attempts (
      state_id TEXT PRIMARY KEY
        REFERENCES factory_floor_launch_states(state_id) ON DELETE CASCADE,
      instance_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL
        CHECK (code_challenge_method = 'S256'),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      CHECK (expires_at > created_at)
    )`,
    `CREATE INDEX factory_floor_oauth_instance_idx
      ON factory_floor_oauth_attempts(instance_id, expires_at)
      WHERE consumed_at IS NULL`,
    `CREATE INDEX factory_floor_oauth_cleanup_idx
      ON factory_floor_oauth_attempts(expires_at, consumed_at)`,
  ],
};
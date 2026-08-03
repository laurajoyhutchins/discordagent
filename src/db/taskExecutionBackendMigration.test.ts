import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './database.js';
import { FACTORY_FLOOR_BINDINGS_MIGRATION } from './factoryFloorBindingsMigration.js';
import { FACTORY_FLOOR_LAUNCH_MIGRATION } from './factoryFloorLaunchMigration.js';
import { FACTORY_FLOOR_OAUTH_MIGRATION } from './factoryFloorOAuthMigration.js';
import { LOOP_SCHEMA_MIGRATION } from './loopSchemaMigration.js';
import { runMigrations } from './migrations.js';
import { SCHEMA_MIGRATIONS } from './schema.js';
import { TASK_EXECUTION_BACKEND_MIGRATION } from './taskExecutionBackendMigration.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function database(name: string): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), `discordagent-${name}-`));
  directories.push(directory);
  const handle = openDatabase(join(directory, 'state.sqlite'));
  handles.push(handle);
  return handle;
}

const PREVIOUS_MIGRATIONS = [
  ...SCHEMA_MIGRATIONS,
  LOOP_SCHEMA_MIGRATION,
  FACTORY_FLOOR_BINDINGS_MIGRATION,
  FACTORY_FLOOR_LAUNCH_MIGRATION,
  FACTORY_FLOOR_OAUTH_MIGRATION,
] as const;

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('task execution-backend migration', () => {
  it('backfills prior tasks and prevents a backend rewrite', () => {
    const db = database('backend-upgrade');
    runMigrations(db, PREVIOUS_MIGRATIONS);

    db.raw.prepare(`
      INSERT INTO projects (
        id, name, working_directory, category_id, agent_channel_id,
        default_provider, models_json, legacy_metadata_json,
        archived_at, created_at, updated_at, reasoning_efforts_json
      ) VALUES (?, ?, ?, ?, ?, 'claude', '{}', NULL, NULL, ?, ?, '{}')
    `).run('project-1', 'discordagent', '/repos/discordagent', 'category-1', 'channel-1', 1, 1);
    db.raw.prepare(`
      INSERT INTO tasks (
        id, project_id, provider, status, channel_id, thread_id,
        objective, created_at, updated_at, settings_json
      ) VALUES (?, ?, 'claude', 'completed', ?, ?, ?, ?, ?, '{}')
    `).run('task-1', 'project-1', 'channel-1', 'thread-1', 'Historical local task', 1, 1);

    runMigrations(db, [TASK_EXECUTION_BACKEND_MIGRATION]);

    expect(db.raw.prepare('SELECT execution_backend FROM tasks WHERE id = ?').get('task-1'))
      .toEqual({ execution_backend: 'local_provider' });
    expect(() => db.raw.prepare('UPDATE tasks SET execution_backend = ? WHERE id = ?')
      .run('factory_floor', 'task-1')).toThrow(/immutable/i);
  });

  it('installs the backend and local-runtime ownership constraints on a clean database', () => {
    const db = database('backend-clean');
    runMigrations(db);

    const migration = db.raw.prepare(`
      SELECT version, name FROM schema_migrations WHERE version = 14
    `).get();
    expect(migration).toEqual({
      version: 14,
      name: 'add immutable task execution backend',
    });

    const triggers = db.raw.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'tasks_execution_backend_immutable',
        'worktrees_require_local_provider_task',
        'provider_sessions_require_local_provider_task'
      )
      ORDER BY name
    `).all();
    expect(triggers).toEqual([
      { name: 'provider_sessions_require_local_provider_task' },
      { name: 'tasks_execution_backend_immutable' },
      { name: 'worktrees_require_local_provider_task' },
    ]);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from './database.js';
import { runMigrations, type Migration } from './migrations.js';

const tempDirectories: string[] = [];
const openHandles: DatabaseHandle[] = [];

function createDatabase(): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-db-'));
  tempDirectories.push(directory);
  const handle = openDatabase(join(directory, 'test.sqlite'));
  openHandles.push(handle);
  return handle;
}

afterEach(() => {
  while (openHandles.length > 0) {
    openHandles.pop()?.close();
  }
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('database migrations', () => {
  it('creates the complete schema idempotently', () => {
    const db = createDatabase();

    runMigrations(db);
    const firstVersions = db.raw.prepare(
      'SELECT version FROM schema_migrations ORDER BY version'
    ).all() as Array<{ version: number }>;

    runMigrations(db);
    const secondVersions = db.raw.prepare(
      'SELECT version FROM schema_migrations ORDER BY version'
    ).all() as Array<{ version: number }>;

    expect(firstVersions.length).toBeGreaterThan(0);
    expect(secondVersions).toEqual(firstVersions);

    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = new Set(tables.map(row => row.name));

    for (const required of [
      'projects',
      'tasks',
      'worktrees',
      'provider_sessions',
      'task_events',
      'task_results',
      'messages',
      'messages_fts',
      'interactions',
      'memory_records',
      'memory_revisions',
      'usage_snapshots',
      'usage_reservations',
      'pending_auth_flows',
    ]) {
      expect(names.has(required), `missing table ${required}`).toBe(true);
    }
  });

  it('rolls back a failed migration without recording its version', () => {
    const db = createDatabase();
    const migrations: Migration[] = [
      {
        version: 999,
        name: 'intentional failure',
        statements: [
          'CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY)',
          'THIS IS NOT VALID SQL',
        ],
      },
    ];

    expect(() => runMigrations(db, migrations)).toThrow();

    const table = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'"
    ).get();
    const recorded = db.raw.prepare(
      'SELECT version FROM schema_migrations WHERE version = 999'
    ).get();

    expect(table).toBeUndefined();
    expect(recorded).toBeUndefined();
  });
});

describe('message full-text search', () => {
  it('synchronizes inserts, updates, and deletes through FTS5 triggers', () => {
    const db = createDatabase();
    runMigrations(db);

    db.raw.prepare(`
      INSERT INTO messages (
        id, channel_id, thread_id, author_id, role, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('m1', 'c1', 't1', 'u1', 'user', 'Docker daemon unavailable', 1);

    expect(db.raw.prepare(
      "SELECT content FROM messages_fts WHERE messages_fts MATCH 'Docker'"
    ).all()).toHaveLength(1);

    db.raw.prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run('Postgres health check unavailable', 'm1');

    expect(db.raw.prepare(
      "SELECT content FROM messages_fts WHERE messages_fts MATCH 'Docker'"
    ).all()).toHaveLength(0);
    expect(db.raw.prepare(
      "SELECT content FROM messages_fts WHERE messages_fts MATCH 'Postgres'"
    ).all()).toHaveLength(1);

    db.raw.prepare('DELETE FROM messages WHERE id = ?').run('m1');

    expect(db.raw.prepare(
      "SELECT content FROM messages_fts WHERE messages_fts MATCH 'Postgres'"
    ).all()).toHaveLength(0);
  });
});

describe('schema invariants', () => {
  it('enforces task, worktree, session, and event uniqueness', () => {
    const db = createDatabase();
    runMigrations(db);

    db.raw.prepare(`
      INSERT INTO projects (
        id, name, working_directory, category_id, agent_channel_id,
        default_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p1', 'factory-floor', '/repos/factory-floor', 'cat1', 'chan1', 'claude', 1, 1);

    const insertTask = db.raw.prepare(`
      INSERT INTO tasks (
        id, project_id, provider, status, channel_id, thread_id,
        objective, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run('task1', 'p1', 'claude', 'created', 'chan1', 'thread1', 'First task', 1, 1);

    expect(() => insertTask.run(
      'task2', 'p1', 'claude', 'created', 'chan1', 'thread1', 'Duplicate thread', 1, 1
    )).toThrow();

    const insertWorktree = db.raw.prepare(`
      INSERT INTO worktrees (
        id, task_id, repository_path, worktree_path, branch_name, base_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertWorktree.run('w1', 'task1', '/repos/factory-floor', '/worktrees/task1', 'agent/claude/task1', 'main', 1);

    expect(() => insertWorktree.run(
      'w2', 'task1', '/repos/factory-floor', '/worktrees/task2', 'agent/claude/task2', 'main', 1
    )).toThrow();

    const insertSession = db.raw.prepare(`
      INSERT INTO provider_sessions (
        id, task_id, provider, session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSession.run('s1', 'task1', 'claude', 'session-1', 1, 1);

    expect(() => insertSession.run('s2', 'task1', 'claude', 'session-2', 1, 1)).toThrow();

    const insertEvent = db.raw.prepare(`
      INSERT INTO task_events (task_id, dedupe_key, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertEvent.run('task1', 'event-1', 'status', '{"phase":"working"}', 1);

    expect(() => insertEvent.run(
      'task1', 'event-1', 'status', '{"phase":"working"}', 2
    )).toThrow();
  });
});

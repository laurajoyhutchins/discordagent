import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { runMigrations, type Migration } from './migrations.js';
import { SCHEMA_MIGRATIONS } from './schema.js';

function legacyProviderMigrations(): Migration[] {
  return SCHEMA_MIGRATIONS
    .filter(migration => migration.version <= 8)
    .map(migration => ({
      version: migration.version,
      name: migration.name,
      statements: migration.statements.map(statement =>
        statement.replaceAll("'claude', 'codex', 'opencode'", "'claude', 'codex'")),
    }));
}

describe('OpenCode provider schema migration', () => {
  it('preserves an existing v8 database and admits OpenCode across constrained tables', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db, legacyProviderMigrations());
      const now = Date.now();

      db.raw.prepare(`
        INSERT INTO projects (
          id, name, working_directory, category_id, agent_channel_id,
          default_provider, models_json, reasoning_efforts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('project-legacy', 'legacy', '/repos/legacy', 'category-legacy', 'channel-legacy', 'claude', '{}', '{}', now, now);
      db.raw.prepare(`
        INSERT INTO tasks (
          id, project_id, provider, status, channel_id, thread_id, objective,
          created_at, updated_at, settings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-legacy', 'project-legacy', 'claude', 'completed', 'channel-legacy', 'thread-legacy', 'preserve me', now, now, '{}');
      db.raw.prepare(`
        INSERT INTO provider_sessions (id, task_id, provider, session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('session-legacy', 'task-legacy', 'claude', 'claude-session', now, now);
      db.raw.prepare(`
        INSERT INTO worktrees (id, task_id, repository_path, worktree_path, branch_name, base_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('worktree-legacy', 'task-legacy', '/repos/legacy', '/worktrees/legacy', 'agent/claude/legacy', 'main', now);
      db.raw.prepare(`
        INSERT INTO task_events (task_id, dedupe_key, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-legacy', 'event-legacy', 'status', '{}', now);
      db.raw.prepare(`
        INSERT INTO project_settings (project_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
      `).run('project-legacy', 'mcpProfile', '"default"', now);
      db.raw.prepare(`
        INSERT INTO task_control_cards (task_id, message_id, pin_state, updated_at)
        VALUES (?, ?, ?, ?)
      `).run('task-legacy', 'message-legacy', 'not_pinned', now);

      runMigrations(db);

      expect(db.raw.prepare('SELECT objective FROM tasks WHERE id = ?').pluck().get('task-legacy')).toBe('preserve me');
      expect(db.raw.prepare('SELECT branch_name FROM worktrees WHERE task_id = ?').pluck().get('task-legacy')).toBe('agent/claude/legacy');
      expect(db.raw.prepare('SELECT value_json FROM project_settings WHERE project_id = ?').pluck().get('project-legacy')).toBe('"default"');
      expect(db.raw.prepare('SELECT message_id FROM task_control_cards WHERE task_id = ?').pluck().get('task-legacy')).toBe('message-legacy');
      expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.raw.pragma('foreign_key_check')).toEqual([]);

      db.raw.prepare(`
        INSERT INTO projects (
          id, name, working_directory, category_id, agent_channel_id,
          default_provider, models_json, reasoning_efforts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('project-opencode', 'opencode', '/repos/opencode', 'category-opencode', 'channel-opencode', 'opencode', '{"opencode":"openai/gpt-5.4"}', '{}', now, now);
      db.raw.prepare(`
        INSERT INTO tasks (
          id, project_id, provider, status, channel_id, thread_id, objective,
          created_at, updated_at, settings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-opencode', 'project-opencode', 'opencode', 'created', 'channel-opencode', 'thread-opencode', 'run OpenCode', now, now, '{"model":"openai/gpt-5.4"}');
      db.raw.prepare(`
        INSERT INTO provider_sessions (id, task_id, provider, session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('session-opencode', 'task-opencode', 'opencode', 'opencode-session', now, now);
      db.raw.prepare(`
        INSERT INTO usage_snapshots (
          provider, window_type, utilization, remaining, resets_at, payload_json, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('opencode', 'session', 0.1, 0.9, null, '{}', now);
      db.raw.prepare(`
        INSERT INTO usage_reservations (
          id, task_id, provider, task_class, estimated_low, estimated_high,
          confidence, status, actual_cost, created_at, released_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('reservation-opencode', 'task-opencode', 'opencode', 'contained_feature', 1, 2, 'medium', 'active', null, now, null);
      db.raw.prepare(`
        INSERT INTO pending_auth_flows (
          id, provider, requested_by, state, created_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('auth-opencode', 'opencode', 'owner', 'checking', now, now + 60_000, now);
      db.raw.prepare(`
        INSERT INTO usage_observations (
          provider, task_class, actual_cost, token_count, duration_ms, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run('opencode', 'contained_feature', 1.5, 100, 1_000, now);

      expect(db.raw.prepare('SELECT default_provider FROM projects WHERE id = ?').pluck().get('project-opencode')).toBe('opencode');
      expect(db.raw.prepare('SELECT provider FROM tasks WHERE id = ?').pluck().get('task-opencode')).toBe('opencode');
      expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});

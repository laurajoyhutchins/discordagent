import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from './projectRepository.js';
import { createProjectSettingsRepository } from './projectSettingsRepository.js';

const handles: DatabaseHandle[] = [];

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

function setup() {
  const db = openDatabase(':memory:');
  handles.push(db);
  runMigrations(db);
  createProjectRepository(db).create({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  return { db, settings: createProjectSettingsRepository(db) };
}

describe('ProjectSettingsRepository', () => {
  it('persists and clears a typed project setting', () => {
    const { settings } = setup();

    settings.set('factory-floor', 'mcpProfile', 'browser');
    expect(settings.get('factory-floor', 'mcpProfile')).toBe('browser');
    settings.clear('factory-floor', 'mcpProfile');
    expect(settings.get('factory-floor', 'mcpProfile')).toBeUndefined();
  });

  it('rejects missing and archived projects', () => {
    const { settings, db } = setup();
    expect(() => settings.get('missing', 'mcpProfile')).toThrow('Project "missing" not found');
    db.raw.prepare('UPDATE projects SET archived_at = ?').run(Date.now());
    expect(() => settings.list('factory-floor')).toThrow('Project "factory-floor" not found');
  });
});

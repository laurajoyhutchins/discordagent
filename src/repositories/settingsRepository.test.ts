import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createSettingsRepository } from './settingsRepository.js';

const handles: DatabaseHandle[] = [];

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

function setup() {
  const db = openDatabase(':memory:');
  handles.push(db);
  runMigrations(db);
  return { db, settings: createSettingsRepository(db) };
}

describe('SettingsRepository', () => {
  it('starts without a global provider and persists the selected provider', () => {
    const { settings } = setup();

    expect(settings.getDefaultProvider()).toBeUndefined();
    settings.setDefaultProvider('codex');
    expect(settings.getDefaultProvider()).toBe('codex');
  });

  it('updates the existing global provider selection', () => {
    const { settings } = setup();

    settings.setDefaultProvider('codex');
    settings.setDefaultProvider('claude');

    expect(settings.getDefaultProvider()).toBe('claude');
  });
});

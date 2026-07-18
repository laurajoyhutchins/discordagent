import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createSettingsRepository } from './settingsRepository.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

describe('SettingsRepository OpenCode provider', () => {
  it('round-trips OpenCode as the global provider', () => {
    const db = openDatabase(':memory:');
    handles.push(db);
    runMigrations(db);
    const settings = createSettingsRepository(db);

    settings.setDefaultProvider('opencode');

    expect(settings.getDefaultProvider()).toBe('opencode');
  });
});

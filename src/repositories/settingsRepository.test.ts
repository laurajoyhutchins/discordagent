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

  it('persists provider-scoped global model and reasoning settings', () => {
    const { settings } = setup();

    expect(settings.getModel('codex')).toBeUndefined();
    expect(settings.getReasoningEffort('codex')).toBeUndefined();
    settings.setModel('codex', 'gpt-5.6-luna');
    settings.setReasoningEffort('codex', 'xhigh');

    expect(settings.getModel('codex')).toBe('gpt-5.6-luna');
    expect(settings.getReasoningEffort('codex')).toBe('xhigh');
  });

  it('persists typed global agent settings', () => {
    const { settings } = setup();

    settings.setDefaultModel('codex', 'gpt-5-codex');
    settings.setPrimaryAgentModel('gpt-5.6-luna');
    settings.setClaudeTimeout(60_000);
    settings.setUsageReserve(25);

    expect(settings.getDefaultModel('codex')).toBe('gpt-5-codex');
    expect(settings.getPrimaryAgentModel()).toBe('gpt-5.6-luna');
    expect(settings.getClaudeTimeout()).toBe(60_000);
    expect(settings.getUsageReserve()).toBe(25);
  });
});

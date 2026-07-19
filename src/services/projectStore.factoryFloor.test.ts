import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getFactoryFloorRuntime,
} from '../factoryFloor/runtime.js';
import {
  closeProjectStore,
  initializeProjectStore,
} from './projectStore.js';

const directories: string[] = [];
const originalEnv = { ...process.env };

function paths() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-project-store-ff-'));
  directories.push(directory);
  return {
    databasePath: join(directory, 'discordagent.sqlite'),
    legacyPath: join(directory, 'projects.json'),
  };
}

function enableFactoryFloor(): void {
  process.env.FACTORY_FLOOR_ENABLED = 'true';
  process.env.FACTORY_FLOOR_BASE_URL = 'https://factory-floor.example/';
  process.env.FACTORY_FLOOR_AGENT_TO_FACTORY_KEY = 'agent-key';
  process.env.FACTORY_FLOOR_FACTORY_TO_AGENT_KEY = 'factory-key';
  process.env.FACTORY_FLOOR_REQUEST_TIMEOUT_MS = '15000';
  process.env.FACTORY_FLOOR_MAX_RETRIES = '1';
}

afterEach(() => {
  closeProjectStore();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('project-store Factory Floor lifecycle', () => {
  it('composes the optional adapter after migrations and clears it before database close', () => {
    enableFactoryFloor();

    initializeProjectStore(paths());
    expect(getFactoryFloorRuntime()).toBeDefined();

    closeProjectStore();
    expect(getFactoryFloorRuntime()).toBeUndefined();
  });

  it('does not prevent project-store startup when enabled configuration is invalid', () => {
    enableFactoryFloor();
    process.env.FACTORY_FLOOR_BASE_URL = 'not-a-url';

    expect(() => initializeProjectStore(paths())).not.toThrow();
    expect(getFactoryFloorRuntime()).toBeUndefined();
  });
});

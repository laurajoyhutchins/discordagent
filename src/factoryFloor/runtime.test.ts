import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import {
  clearFactoryFloorRuntime,
  getFactoryFloorRuntime,
  initializeFactoryFloorRuntime,
} from './runtime.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function database(): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-factory-floor-runtime-'));
  directories.push(directory);
  const handle = openDatabase(join(directory, 'test.sqlite'));
  handles.push(handle);
  runMigrations(handle);
  return handle;
}

function enabledEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    FACTORY_FLOOR_ENABLED: 'true',
    FACTORY_FLOOR_BASE_URL: 'https://factory-floor.example/',
    FACTORY_FLOOR_AGENT_TO_FACTORY_KEY: 'agent-key',
    FACTORY_FLOOR_FACTORY_TO_AGENT_KEY: 'factory-key',
    FACTORY_FLOOR_REQUEST_TIMEOUT_MS: '15000',
    FACTORY_FLOOR_MAX_RETRIES: '1',
    ...overrides,
  };
}

afterEach(() => {
  clearFactoryFloorRuntime();
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('Factory Floor runtime composition', () => {
  it('is a silent no-op while the adapter is disabled', () => {
    const logger = vi.fn();

    expect(initializeFactoryFloorRuntime(database(), { env: {}, logger })).toBeUndefined();
    expect(getFactoryFloorRuntime()).toBeUndefined();
    expect(logger).not.toHaveBeenCalled();
  });

  it('isolates invalid enabled configuration from the direct-provider runtime', () => {
    const logger = vi.fn();

    expect(initializeFactoryFloorRuntime(database(), {
      env: enabledEnv({
        FACTORY_FLOOR_BASE_URL: 'https://user:secret@factory-floor.example/private',
      }),
      logger,
    })).toBeUndefined();

    expect(getFactoryFloorRuntime()).toBeUndefined();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/adapter disabled.*configuration/i));
    expect(logger.mock.calls.flat().join(' ')).not.toContain('user:secret');
  });

  it('constructs local bindings and clients without making a startup request', () => {
    const fetchFn = vi.fn<typeof fetch>();

    const runtime = initializeFactoryFloorRuntime(database(), {
      env: enabledEnv(),
      fetchFn,
    });

    expect(runtime).toBeDefined();
    expect(runtime?.bindings).toBeDefined();
    expect(runtime?.serviceClient).toBeDefined();
    expect(runtime?.operatorClient).toBeUndefined();
    expect(getFactoryFloorRuntime()).toBe(runtime);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('constructs the least-privileged operator client only when configured', () => {
    const runtime = initializeFactoryFloorRuntime(database(), {
      env: enabledEnv({ FACTORY_FLOOR_OPERATOR_TOKEN: 'operator-token' }),
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(runtime?.operatorClient).toBeDefined();
    clearFactoryFloorRuntime();
    expect(getFactoryFloorRuntime()).toBeUndefined();
  });
});

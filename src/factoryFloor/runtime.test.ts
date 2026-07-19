import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createFactoryFloorBindingRepository } from '../repositories/factoryFloorBindingRepository.js';
import { createFactoryFloorLaunchRepository } from '../repositories/factoryFloorLaunchRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
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
    DISCORD_CLIENT_ID: 'application-1',
    DISCORD_GUILD_ID: 'guild-1',
    FACTORY_FLOOR_ENABLED: 'true',
    FACTORY_FLOOR_BASE_URL: 'https://factory-floor.example/',
    FACTORY_FLOOR_AGENT_TO_FACTORY_KEY: 'agent-key',
    FACTORY_FLOOR_FACTORY_TO_AGENT_KEY: 'factory-key',
    FACTORY_FLOOR_REQUEST_TIMEOUT_MS: '15000',
    FACTORY_FLOOR_MAX_RETRIES: '1',
    ...overrides,
  };
}

function seedProjectLaunches(db: DatabaseHandle): void {
  createProjectRepository(db).create({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  createFactoryFloorBindingRepository(db).bindProject({
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    guildId: 'guild-1',
  });
  const launches = createFactoryFloorLaunchRepository(db);
  const base = {
    applicationId: 'application-1',
    installationType: 'guild' as const,
    installationOwnerId: 'guild-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    principalId: 'user-1',
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    contextKind: 'project' as const,
    createdAt: 1_000,
  };
  launches.create({
    ...base,
    stateId: 'expired-state',
    interactionId: 'expired-interaction',
    expiresAt: 2_000,
  });
  launches.create({
    ...base,
    stateId: 'live-state',
    interactionId: 'live-interaction',
    expiresAt: 20_000,
  });
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

  it('constructs local bindings, launch state, nonce storage, and clients without a startup request', async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const runtime = initializeFactoryFloorRuntime(database(), {
      env: enabledEnv(),
      fetchFn,
    });

    expect(runtime).toBeDefined();
    expect(runtime?.bindings).toBeDefined();
    expect(runtime?.launches).toBeDefined();
    expect(runtime?.activityLaunch).toBeDefined();
    expect(runtime?.nonceStore).toBeDefined();
    expect(runtime?.serviceClient).toBeDefined();
    expect(runtime?.operatorClient).toBeUndefined();
    expect(getFactoryFloorRuntime()).toBe(runtime);
    expect(fetchFn).not.toHaveBeenCalled();

    expect(await runtime!.nonceStore.consumeNonce('ff-ff-to-agent-v1', 'nonce-1', 1_000)).toBe(true);
    expect(await runtime!.nonceStore.consumeNonce('ff-ff-to-agent-v1', 'nonce-1', 1_001)).toBe(false);
  });

  it('cleans terminal or expired launch registrations without deleting live state', () => {
    const db = database();
    seedProjectLaunches(db);
    const logger = vi.fn();

    const runtime = initializeFactoryFloorRuntime(db, {
      env: enabledEnv(),
      now: () => 10_000,
      logger,
    });

    expect(runtime?.launches.findByStateId('expired-state')).toBeUndefined();
    expect(runtime?.launches.findByStateId('live-state')).toBeDefined();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/cleaned 1.*launch registration/i));
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

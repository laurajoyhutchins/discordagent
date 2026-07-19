import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createFactoryFloorBindingRepository } from './factoryFloorBindingRepository.js';
import { createFactoryFloorLaunchRepository } from './factoryFloorLaunchRepository.js';
import { createProjectRepository } from './projectRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-activity-launch-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);

  createProjectRepository(db).create({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  const bindings = createFactoryFloorBindingRepository(db);
  bindings.bindProject({
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    guildId: 'guild-1',
  });
  const surface = bindings.bindSurface({
    projectName: 'factory-floor',
    guildId: 'guild-1',
    channelId: 'agent-1',
    threadId: 'thread-1',
  });
  bindings.bindRun({
    projectName: 'factory-floor',
    surfaceId: surface.id,
    runId: 'run-1',
  });

  return {
    db,
    launches: createFactoryFloorLaunchRepository(db),
    surface,
  };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function launchInput(surfaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    stateId: 'state-opaque-1',
    interactionId: 'interaction-1',
    applicationId: 'application-1',
    installationType: 'guild' as const,
    installationOwnerId: 'guild-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    threadId: 'thread-1',
    principalId: 'user-1',
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    surfaceId,
    runId: 'run-1',
    contextKind: 'run' as const,
    createdAt: 1_000,
    expiresAt: 121_000,
    ...overrides,
  };
}

function expectedContext(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'application-1',
    installationType: 'guild' as const,
    installationOwnerId: 'guild-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    threadId: 'thread-1',
    principalId: 'user-1',
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    surfaceId: expect.any(String),
    runId: 'run-1',
    contextKind: 'run' as const,
    ...overrides,
  };
}

describe('FactoryFloorLaunchRepository', () => {
  it('creates an opaque short-lived registration without storing browser-selected authority', () => {
    const { launches, surface } = setup();

    const record = launches.create(launchInput(surface.id));

    expect(record).toEqual(expect.objectContaining({
      stateId: 'state-opaque-1',
      interactionId: 'interaction-1',
      createdAt: 1_000,
      expiresAt: 121_000,
      consumedAt: undefined,
      invalidatedAt: undefined,
      invalidationReason: undefined,
      ...expectedContext({ surfaceId: surface.id }),
    }));
    expect(launches.findByStateId('state-opaque-1')).toEqual(record);
  });

  it('returns the original state and expiry for an exact interaction retry', () => {
    const { launches, surface } = setup();

    const first = launches.create(launchInput(surface.id));
    const second = launches.create(launchInput(surface.id, {
      stateId: 'state-opaque-retry-candidate',
      createdAt: 2_000,
      expiresAt: 122_000,
    }));

    expect(second).toEqual(first);
    expect(second.stateId).toBe('state-opaque-1');
    expect(second.createdAt).toBe(1_000);
    expect(second.expiresAt).toBe(121_000);
    expect(launches.findByStateId('state-opaque-retry-candidate')).toBeUndefined();
  });

  it('rejects conflicting reuse of an interaction ID', () => {
    const { launches, surface } = setup();
    launches.create(launchInput(surface.id));

    expect(() => launches.create(launchInput(surface.id, {
      stateId: 'state-opaque-2',
      principalId: 'user-2',
    }))).toThrow(/interaction.*conflict/i);
  });

  it('consumes once only when every trusted context field matches', () => {
    const { launches, surface } = setup();
    launches.create(launchInput(surface.id));

    expect(launches.consume({
      stateId: 'state-opaque-1',
      now: 2_000,
      expected: expectedContext({ surfaceId: surface.id }),
    })).toEqual(expect.objectContaining({ consumedAt: 2_000 }));

    expect(launches.consume({
      stateId: 'state-opaque-1',
      now: 2_001,
      expected: expectedContext({ surfaceId: surface.id }),
    })).toBeUndefined();
  });

  it.each([
    ['applicationId', 'application-other'],
    ['installationOwnerId', 'guild-other'],
    ['guildId', 'guild-other'],
    ['channelId', 'agent-other'],
    ['threadId', 'thread-other'],
    ['principalId', 'user-other'],
    ['projectName', 'reading'],
    ['factoryFloorProjectId', 'ff-project-other'],
    ['surfaceId', 'surface-other'],
    ['runId', 'run-other'],
  ])('fails closed on %s mismatch', (field, value) => {
    const { launches, surface } = setup();
    launches.create(launchInput(surface.id));

    expect(launches.consume({
      stateId: 'state-opaque-1',
      now: 2_000,
      expected: expectedContext({ surfaceId: surface.id, [field]: value }),
    })).toBeUndefined();
    expect(launches.findByStateId('state-opaque-1')?.consumedAt).toBeUndefined();
  });

  it('rejects expired or invalidated state and keeps bounded operator evidence', () => {
    const { launches, surface } = setup();
    launches.create(launchInput(surface.id));

    expect(launches.consume({
      stateId: 'state-opaque-1',
      now: 121_000,
      expected: expectedContext({ surfaceId: surface.id }),
    })).toBeUndefined();

    expect(launches.invalidate('state-opaque-1', 'Discord launch callback failed', 122_000))
      .toEqual(expect.objectContaining({
        invalidatedAt: 122_000,
        invalidationReason: 'Discord launch callback failed',
      }));
    expect(launches.invalidate('state-opaque-1', 'duplicate', 122_001)).toBeUndefined();
  });

  it('cleans expired, consumed, and invalidated registrations without deleting live state', () => {
    const { launches, surface } = setup();
    launches.create(launchInput(surface.id, {
      stateId: 'expired', interactionId: 'interaction-expired', expiresAt: 2_000,
    }));
    launches.create(launchInput(surface.id, {
      stateId: 'consumed', interactionId: 'interaction-consumed', expiresAt: 20_000,
    }));
    launches.consume({
      stateId: 'consumed',
      now: 3_000,
      expected: expectedContext({ surfaceId: surface.id }),
    });
    launches.create(launchInput(surface.id, {
      stateId: 'invalidated', interactionId: 'interaction-invalidated', expiresAt: 20_000,
    }));
    launches.invalidate('invalidated', 'cancelled', 3_000);
    launches.create(launchInput(surface.id, {
      stateId: 'live', interactionId: 'interaction-live', expiresAt: 20_000,
    }));

    expect(launches.cleanup(10_000)).toBe(3);
    expect(launches.findByStateId('live')).toBeDefined();
    expect(launches.findByStateId('expired')).toBeUndefined();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from './projectRepository.js';
import {
  createFactoryFloorActivityInstanceBindingRepository,
} from './factoryFloorActivityInstanceBindingRepository.js';
import {
  createFactoryFloorBindingRepository,
  FactoryFloorBindingConflictError,
} from './factoryFloorBindingRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function database(): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-activity-binding-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);
  createProjectRepository(db).create({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'channel-1',
    defaultProvider: 'claude',
  });
  return db;
}

afterEach(() => {
  while (handles.length) handles.pop()?.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('Factory Floor Activity instance binding', () => {
  it('attaches a validated Activity instance to the existing run surface', () => {
    const db = database();
    const bindings = createFactoryFloorBindingRepository(db);
    const activityInstances = createFactoryFloorActivityInstanceBindingRepository(db);
    bindings.bindProject({
      projectName: 'factory-floor',
      factoryFloorProjectId: 'ff-project-1',
      guildId: 'guild-1',
    });
    const surface = bindings.bindSurface({
      projectName: 'factory-floor',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });
    bindings.bindRun({
      projectName: 'factory-floor',
      surfaceId: surface.id,
      runId: 'run-1',
    });

    const attached = activityInstances.bind(surface.id, 'instance-1');

    expect(attached).toMatchObject({
      id: surface.id,
      threadId: 'thread-1',
      activityInstanceId: 'instance-1',
    });
    expect(bindings.findSurfaceByActivityInstance('instance-1')).toEqual(attached);
    expect(bindings.findRun('run-1')).toMatchObject({ surfaceId: surface.id });
  });

  it('is idempotent for the same surface and instance', () => {
    const db = database();
    const bindings = createFactoryFloorBindingRepository(db);
    const activityInstances = createFactoryFloorActivityInstanceBindingRepository(db);
    bindings.bindProject({ projectName: 'factory-floor', factoryFloorProjectId: 'ff-project-1', guildId: 'guild-1' });
    const surface = bindings.bindSurface({ projectName: 'factory-floor', guildId: 'guild-1', channelId: 'channel-1', threadId: 'thread-1' });

    expect(activityInstances.bind(surface.id, 'instance-1')).toEqual(
      activityInstances.bind(surface.id, 'instance-1'),
    );
  });

  it('fails closed when an instance or surface is already bound elsewhere', () => {
    const db = database();
    const bindings = createFactoryFloorBindingRepository(db);
    const activityInstances = createFactoryFloorActivityInstanceBindingRepository(db);
    bindings.bindProject({ projectName: 'factory-floor', factoryFloorProjectId: 'ff-project-1', guildId: 'guild-1' });
    const one = bindings.bindSurface({ projectName: 'factory-floor', guildId: 'guild-1', channelId: 'channel-1', threadId: 'thread-1' });
    const two = bindings.bindSurface({ projectName: 'factory-floor', guildId: 'guild-1', channelId: 'channel-1', threadId: 'thread-2' });
    activityInstances.bind(one.id, 'instance-1');

    expect(() => activityInstances.bind(one.id, 'instance-2')).toThrowError(
      expect.objectContaining<Partial<FactoryFloorBindingConflictError>>({
        code: 'surface_activity_instance_conflict',
      }),
    );
    expect(() => activityInstances.bind(two.id, 'instance-1')).toThrowError(
      expect.objectContaining<Partial<FactoryFloorBindingConflictError>>({
        code: 'activity_instance_already_bound',
      }),
    );
  });
});

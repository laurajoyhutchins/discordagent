import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { SCHEMA_MIGRATIONS } from '../db/schema.js';
import { createProjectRepository } from './projectRepository.js';
import {
  createFactoryFloorBindingRepository,
  createFactoryFloorNonceStore,
} from './factoryFloorBindingRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function database(): DatabaseHandle {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-factory-floor-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  return db;
}

function createProject(db: DatabaseHandle, name: string, channelId: string): void {
  createProjectRepository(db).create({
    name,
    workingDirectory: `/repos/${name}`,
    categoryId: `category-${name}`,
    agentChannelId: channelId,
    defaultProvider: 'claude',
  });
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe('FactoryFloorBindingRepository', () => {
  it('upgrades append-only without changing existing project data', () => {
    const db = database();
    runMigrations(db, SCHEMA_MIGRATIONS);
    createProject(db, 'factory-floor', 'channel-1');

    runMigrations(db);
    runMigrations(db);

    expect(createProjectRepository(db).findByName('factory-floor')).toMatchObject({
      name: 'factory-floor',
      agentChannelId: 'channel-1',
      defaultProvider: 'claude',
    });
    expect((db.raw.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10
    `).get() as { count: number }).count).toBe(1);
  });

  it('creates idempotent project, surface, and run bindings', () => {
    const db = database();
    runMigrations(db);
    createProject(db, 'factory-floor', 'channel-1');
    const bindings = createFactoryFloorBindingRepository(db);

    const project = bindings.bindProject({
      projectName: 'factory-floor',
      factoryFloorProjectId: 'ff-project-1',
      guildId: 'guild-1',
    });
    expect(bindings.bindProject({
      projectName: 'FACTORY-FLOOR',
      factoryFloorProjectId: 'ff-project-1',
      guildId: 'guild-1',
    })).toMatchObject({
      projectName: project.projectName,
      factoryFloorProjectId: project.factoryFloorProjectId,
      guildId: project.guildId,
      createdAt: project.createdAt,
    });

    const surface = bindings.bindSurface({
      projectName: 'factory-floor',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'message-1',
      activityInstanceId: 'activity-1',
    });
    expect(bindings.bindSurface({
      projectName: 'factory-floor',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'message-1',
      activityInstanceId: 'activity-1',
    })).toMatchObject({
      id: surface.id,
      projectName: surface.projectName,
      guildId: surface.guildId,
      channelId: surface.channelId,
      threadId: surface.threadId,
      messageId: surface.messageId,
      activityInstanceId: surface.activityInstanceId,
      createdAt: surface.createdAt,
    });

    const run = bindings.bindRun({
      projectName: 'factory-floor',
      surfaceId: surface.id,
      runId: 'run-1',
    });
    expect(bindings.bindRun({
      projectName: 'factory-floor',
      surfaceId: surface.id,
      runId: 'run-1',
    })).toMatchObject({
      runId: run.runId,
      projectName: run.projectName,
      surfaceId: run.surfaceId,
      createdAt: run.createdAt,
    });
    expect(bindings.findRun('run-1')).toMatchObject({
      runId: run.runId,
      projectName: run.projectName,
      surfaceId: run.surfaceId,
      createdAt: run.createdAt,
    });
  });

  it('fails closed when identities cross project, guild, surface, or run boundaries', () => {
    const db = database();
    runMigrations(db);
    createProject(db, 'one', 'channel-1');
    createProject(db, 'two', 'channel-2');
    const bindings = createFactoryFloorBindingRepository(db);
    bindings.bindProject({
      projectName: 'one',
      factoryFloorProjectId: 'ff-one',
      guildId: 'guild-1',
    });
    bindings.bindProject({
      projectName: 'two',
      factoryFloorProjectId: 'ff-two',
      guildId: 'guild-1',
    });

    expect(() => bindings.bindProject({
      projectName: 'two',
      factoryFloorProjectId: 'ff-one',
      guildId: 'guild-1',
    })).toThrow('project_binding_conflict');
    expect(() => bindings.bindSurface({
      projectName: 'one',
      guildId: 'guild-2',
      channelId: 'channel-1',
      threadId: 'thread-1',
    })).toThrow('surface_guild_mismatch');

    const surface = bindings.bindSurface({
      projectName: 'one',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      activityInstanceId: 'activity-1',
    });
    expect(() => bindings.bindSurface({
      projectName: 'two',
      guildId: 'guild-1',
      channelId: 'channel-2',
      activityInstanceId: 'activity-1',
    })).toThrow('surface_binding_conflict');
    expect(() => bindings.bindRun({
      projectName: 'two',
      surfaceId: surface.id,
      runId: 'run-crossed',
    })).toThrow('run_project_mismatch');

    bindings.bindRun({
      projectName: 'one',
      surfaceId: surface.id,
      runId: 'run-1',
    });
    expect(() => bindings.bindRun({
      projectName: 'one',
      surfaceId: surface.id,
      runId: 'run-2',
    })).toThrow('surface_already_bound_to_run');
  });

  it('retires linkage without storing Factory Floor runtime state', () => {
    const db = database();
    runMigrations(db);
    createProject(db, 'factory-floor', 'channel-1');
    const bindings = createFactoryFloorBindingRepository(db);
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

    expect(bindings.retireProject('factory-floor')).toBe(true);
    expect(bindings.findProjectByName('factory-floor')).toBeUndefined();
    expect(bindings.findSurfaceById(surface.id)).toBeUndefined();
    expect(bindings.findRun('run-1')).toBeUndefined();

    const runColumns = (db.raw.prepare(`
      PRAGMA table_info(factory_floor_run_bindings)
    `).all() as { name: string }[]).map(column => column.name);
    expect(runColumns).not.toContain('status');
    expect(runColumns).not.toContain('events');
    expect(runColumns).not.toContain('artifacts');
    expect(runColumns).not.toContain('approvals');
  });
});

describe('Factory Floor nonce store', () => {
  it('rejects replay and permits bounded reuse only after expiry', () => {
    const db = database();
    runMigrations(db);
    const store = createFactoryFloorNonceStore(db, 100);

    expect(store.consumeNonce('key-1', 'nonce-1', 1_000)).toBe(true);
    expect(store.consumeNonce('key-1', 'nonce-1', 1_050)).toBe(false);
    expect(store.consumeNonce('key-1', 'nonce-1', 1_101)).toBe(true);
  });
});

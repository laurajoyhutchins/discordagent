import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createFactoryFloorBindingRepository } from './factoryFloorBindingRepository.js';
import { createFactoryFloorLaunchInteractionLookup } from './factoryFloorLaunchInteractionLookup.js';
import { createFactoryFloorLaunchRepository } from './factoryFloorLaunchRepository.js';
import {
  createFactoryFloorOAuthRepository,
  FactoryFloorOAuthConflictError,
} from './factoryFloorOAuthRepository.js';
import { createProjectRepository } from './projectRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-activity-oauth-'));
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

  const launches = createFactoryFloorLaunchRepository(db);
  launches.create({
    stateId: 'opaque-state-1',
    interactionId: 'launch-1',
    applicationId: 'application-1',
    installationType: 'guild',
    installationOwnerId: 'guild-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    threadId: 'thread-1',
    principalId: 'user-1',
    projectName: 'factory-floor',
    factoryFloorProjectId: 'ff-project-1',
    surfaceId: surface.id,
    runId: 'run-1',
    contextKind: 'run',
    createdAt: 1_000,
    expiresAt: 121_000,
  });

  return {
    launches,
    launchLookup: createFactoryFloorLaunchInteractionLookup(db),
    oauth: createFactoryFloorOAuthRepository(db),
  };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc';
const codeChallenge = challenge(verifier);

function beginInput(overrides: Record<string, unknown> = {}) {
  return {
    stateId: 'opaque-state-1',
    instanceId: 'i-launch-1-gc-guild-1-agent-1',
    codeChallenge,
    createdAt: 2_000,
    expiresAt: 62_000,
    ...overrides,
  };
}

describe('FactoryFloorOAuthRepository', () => {
  it('finds a DA-2 launch by Discord launch ID', () => {
    const { launchLookup } = setup();

    expect(launchLookup.findByInteractionId('launch-1')).toEqual(
      expect.objectContaining({
        stateId: 'opaque-state-1',
        principalId: 'user-1',
        runId: 'run-1',
      }),
    );
  });

  it('registers one S256 challenge and keeps exact retries idempotent', () => {
    const { oauth } = setup();
    const first = oauth.begin(beginInput());
    const retry = oauth.begin(beginInput({ createdAt: 3_000, expiresAt: 63_000 }));

    expect(first).toEqual({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeChallenge,
      codeChallengeMethod: 'S256',
      createdAt: 2_000,
      expiresAt: 62_000,
      consumedAt: undefined,
    });
    expect(retry).toEqual(first);
  });

  it.each([
    ['instance', { instanceId: 'i-other' }],
    ['challenge', { codeChallenge: challenge(`${verifier}x`) }],
  ])('rejects conflicting reuse of launch state for another %s', (_label, override) => {
    const { oauth } = setup();
    oauth.begin(beginInput());

    expect(() => oauth.begin(beginInput(override))).toThrowError(
      expect.objectContaining<Partial<FactoryFloorOAuthConflictError>>({
        name: 'FactoryFloorOAuthConflictError',
        code: 'oauth_attempt_conflict',
      }),
    );
  });

  it('verifies the S256 code verifier and consumes the attempt once', () => {
    const { oauth } = setup();
    oauth.begin(beginInput());

    expect(oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: `${verifier}wrong`,
      now: 3_000,
    })).toBeUndefined();
    expect(oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: verifier,
      now: 3_001,
    })).toEqual(expect.objectContaining({ consumedAt: 3_001 }));
    expect(oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: verifier,
      now: 3_002,
    })).toBeUndefined();
  });

  it('rejects expired attempts and attempts whose launch is no longer active', () => {
    const expired = setup();
    expired.oauth.begin(beginInput({ expiresAt: 3_000 }));
    expect(expired.oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: verifier,
      now: 3_000,
    })).toBeUndefined();

    const retired = setup();
    retired.oauth.begin(beginInput());
    retired.launches.invalidate('opaque-state-1', 'launch no longer valid', 2_500);
    expect(retired.oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: verifier,
      now: 3_000,
    })).toBeUndefined();
  });

  it('cleans expired and consumed attempts without deleting live state', () => {
    const { oauth } = setup();
    oauth.begin(beginInput({ expiresAt: 4_000 }));
    oauth.verifyAndConsume({
      stateId: 'opaque-state-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      codeVerifier: verifier,
      now: 3_000,
    });

    expect(oauth.cleanup(5_000)).toBe(1);
    expect(oauth.findByStateId('opaque-state-1')).toBeUndefined();
  });
});

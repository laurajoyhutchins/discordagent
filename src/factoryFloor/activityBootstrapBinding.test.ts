import { describe, expect, it, vi } from 'vitest';
import type { FactoryFloorLaunchRecord } from '../repositories/factoryFloorLaunchRepository.js';
import {
  createActivityBootstrapService,
  type ActivityBootstrapDependencies,
} from './activityBootstrapService.js';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc';
const challenge = 'dYSqskoTcWrpu8GYY0XpWlzOc0c5rd9YO3uAgh_zmV4';

const launch: FactoryFloorLaunchRecord = {
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
  surfaceId: 'surface-1',
  runId: 'run-1',
  contextKind: 'run',
  createdAt: 1_000,
  expiresAt: 121_000,
};

it('attaches the fully validated Activity instance to the existing run surface before session issuance', async () => {
  const bindActivityInstance = vi.fn();
  const createSession = vi.fn(async () => ({
    instanceBindingId: 'binding-1',
    sessionToken: 'factory-floor-session',
    expiresAt: '2026-07-20T01:00:00.000Z',
    idleExpiresAt: '2026-07-20T00:40:00.000Z',
  }));
  const dependencies = {
    applicationId: 'application-1',
    oauthScopes: ['identify'],
    oauthTtlMs: 60_000,
    now: () => 3_000,
    discord: {
      getActivityInstance: vi.fn(async () => ({
        applicationId: 'application-1',
        instanceId: 'instance-1',
        launchId: 'launch-1',
        location: {
          id: 'gc-guild-1-thread-1',
          kind: 'gc' as const,
          guildId: 'guild-1',
          channelId: 'thread-1',
        },
        users: ['user-1'],
      })),
      exchangeAuthorizationCode: vi.fn(async () => ({
        accessToken: 'discord-access-token',
        tokenType: 'Bearer' as const,
        expiresIn: 3600,
        scope: 'identify',
      })),
      getCurrentUser: vi.fn(async () => ({ id: 'user-1' })),
    },
    launchLookup: { findByInteractionId: vi.fn(() => launch) },
    launches: {
      findByStateId: vi.fn(() => launch),
      consume: vi.fn(() => ({ ...launch, consumedAt: 3_000 })),
    },
    oauth: {
      begin: vi.fn(),
      findByStateId: vi.fn(() => ({
        stateId: launch.stateId,
        instanceId: 'instance-1',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256' as const,
        createdAt: 2_000,
        expiresAt: 62_000,
      })),
      verifyAndConsume: vi.fn(() => ({
        stateId: launch.stateId,
        instanceId: 'instance-1',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256' as const,
        createdAt: 2_000,
        expiresAt: 62_000,
        consumedAt: 3_000,
      })),
    },
    bindings: { bindActivityInstance },
    resolveMember: vi.fn(async () => ({ userId: 'user-1', authorized: true })),
    factoryFloor: { createOrJoinActivitySession: createSession },
  } satisfies ActivityBootstrapDependencies & {
    bindings: { bindActivityInstance(surfaceId: string, instanceId: string): unknown };
  };

  await createActivityBootstrapService(dependencies).bootstrap({
    state: launch.stateId,
    instanceId: 'instance-1',
    code: 'authorization-code',
    codeVerifier: verifier,
    redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
  });

  expect(bindActivityInstance).toHaveBeenCalledWith('surface-1', 'instance-1');
  expect(bindActivityInstance.mock.invocationCallOrder[0]).toBeLessThan(
    createSession.mock.invocationCallOrder[0]!,
  );
});

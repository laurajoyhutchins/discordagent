import { describe, expect, it, vi } from 'vitest';
import type { FactoryFloorLaunchRecord } from '../repositories/factoryFloorLaunchRepository.js';
import {
  ActivityBootstrapError,
  createActivityBootstrapService,
  type ActivityBootstrapDependencies,
} from './activityBootstrapService.js';

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

const instance = {
  applicationId: 'application-1',
  instanceId: 'i-launch-1-gc-guild-1-thread-1',
  launchId: 'launch-1',
  location: {
    id: 'gc-guild-1-thread-1',
    kind: 'gc' as const,
    guildId: 'guild-1',
    channelId: 'thread-1',
  },
  users: ['user-1'],
};

function dependencies(overrides: Partial<ActivityBootstrapDependencies> = {}) {
  const oauthBegin = vi.fn(() => ({
    stateId: launch.stateId,
    instanceId: instance.instanceId,
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256' as const,
    createdAt: 2_000,
    expiresAt: 62_000,
    consumedAt: undefined,
  }));
  const oauthConsume = vi.fn(() => ({
    stateId: launch.stateId,
    instanceId: instance.instanceId,
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256' as const,
    createdAt: 2_000,
    expiresAt: 62_000,
    consumedAt: 3_000,
  }));
  const launchConsume = vi.fn(() => ({ ...launch, consumedAt: 3_000 }));
  const createSession = vi.fn(async () => ({
    instanceBindingId: 'binding-1',
    sessionToken: 'factory-floor-session',
    expiresAt: '2026-07-20T01:00:00.000Z',
    idleExpiresAt: '2026-07-20T00:40:00.000Z',
  }));
  const deps: ActivityBootstrapDependencies = {
    applicationId: 'application-1',
    oauthScopes: ['identify'],
    oauthTtlMs: 60_000,
    now: () => 2_000,
    discord: {
      getActivityInstance: vi.fn(async () => instance),
      exchangeAuthorizationCode: vi.fn(async () => ({
        accessToken: 'discord-access-token',
        tokenType: 'Bearer' as const,
        expiresIn: 3600,
        scope: 'identify',
      })),
      getCurrentUser: vi.fn(async () => ({ id: 'user-1' })),
    },
    launchLookup: {
      findByInteractionId: vi.fn(() => launch),
    },
    launches: {
      findByStateId: vi.fn(() => launch),
      consume: launchConsume,
    },
    oauth: {
      begin: oauthBegin,
      verifyAndConsume: oauthConsume,
    },
    resolveMember: vi.fn(async () => ({ userId: 'user-1', authorized: true })),
    factoryFloor: {
      createOrJoinActivitySession: createSession,
    },
    ...overrides,
  };
  return { deps, oauthBegin, oauthConsume, launchConsume, createSession };
}

const challenge = 'J7-8bkm7W7V9l7xZQ8F1NzXWjY9yZK9lGxT5xgYf0JQ';
const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc';

describe('ActivityBootstrapService', () => {
  it('starts OAuth only after validating the live instance, launch, participant, and member', async () => {
    const { deps, oauthBegin } = dependencies();
    const service = createActivityBootstrapService(deps);

    await expect(service.startOAuth({
      instanceId: instance.instanceId,
      codeChallenge: challenge,
    })).resolves.toEqual({
      state: 'opaque-state-1',
      clientId: 'application-1',
      scopes: ['identify'],
      codeChallengeMethod: 'S256',
      expiresAt: 62_000,
    });
    expect(deps.resolveMember).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(oauthBegin).toHaveBeenCalledWith({
      stateId: 'opaque-state-1',
      instanceId: instance.instanceId,
      codeChallenge: challenge,
      createdAt: 2_000,
      expiresAt: 62_000,
    });
  });

  it.each([
    ['application', { discord: { ...dependencies().deps.discord, getActivityInstance: vi.fn(async () => ({ ...instance, applicationId: 'other' })) } }, 'activity_application_mismatch'],
    ['launch', { launchLookup: { findByInteractionId: vi.fn(() => undefined) } }, 'activity_launch_not_found'],
    ['guild', { discord: { ...dependencies().deps.discord, getActivityInstance: vi.fn(async () => ({ ...instance, location: { ...instance.location, guildId: 'other' } })) } }, 'activity_location_mismatch'],
    ['channel', { discord: { ...dependencies().deps.discord, getActivityInstance: vi.fn(async () => ({ ...instance, location: { ...instance.location, channelId: 'other' } })) } }, 'activity_location_mismatch'],
    ['participant', { discord: { ...dependencies().deps.discord, getActivityInstance: vi.fn(async () => ({ ...instance, users: ['user-2'] })) } }, 'activity_principal_not_present'],
    ['member', { resolveMember: vi.fn(async () => undefined) }, 'activity_member_unavailable'],
    ['authorization', { resolveMember: vi.fn(async () => ({ userId: 'user-1', authorized: false })) }, 'activity_not_authorized'],
  ])('fails closed on %s mismatch before issuing OAuth state', async (_label, override, code) => {
    const { deps, oauthBegin } = dependencies(override as Partial<ActivityBootstrapDependencies>);
    await expect(createActivityBootstrapService(deps).startOAuth({
      instanceId: instance.instanceId,
      codeChallenge: challenge,
    })).rejects.toEqual(expect.objectContaining<Partial<ActivityBootstrapError>>({
      name: 'ActivityBootstrapError',
      code,
    }));
    expect(oauthBegin).not.toHaveBeenCalled();
  });

  it('exchanges OAuth, revalidates identity, consumes state once, and creates the session', async () => {
    const { deps, oauthConsume, launchConsume, createSession } = dependencies({ now: () => 3_000 });
    const service = createActivityBootstrapService(deps);

    await expect(service.bootstrap({
      state: launch.stateId,
      instanceId: instance.instanceId,
      code: 'authorization-code',
      codeVerifier: verifier,
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
    })).resolves.toEqual({
      discord: {
        accessToken: 'discord-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'identify',
      },
      factoryFloor: {
        instanceBindingId: 'binding-1',
        sessionToken: 'factory-floor-session',
        expiresAt: '2026-07-20T01:00:00.000Z',
        idleExpiresAt: '2026-07-20T00:40:00.000Z',
      },
      context: {
        kind: 'run',
        projectId: 'ff-project-1',
        runId: 'run-1',
      },
    });

    expect(oauthConsume).toHaveBeenCalledWith({
      stateId: launch.stateId,
      instanceId: instance.instanceId,
      codeVerifier: verifier,
      now: 3_000,
    });
    expect(launchConsume).toHaveBeenCalledWith({
      stateId: launch.stateId,
      now: 3_000,
      expected: expect.objectContaining({
        applicationId: 'application-1',
        guildId: 'guild-1',
        channelId: 'agent-1',
        threadId: 'thread-1',
        principalId: 'user-1',
        runId: 'run-1',
      }),
    });
    expect(createSession).toHaveBeenCalledWith({
      applicationId: 'application-1',
      instanceId: instance.instanceId,
      installationId: 'guild-1',
      guildId: 'guild-1',
      channelId: 'agent-1',
      threadId: 'thread-1',
      launchId: 'launch-1',
      principalId: 'user-1',
      adapter: 'discord-agent',
      boundRunId: 'run-1',
    });
  });

  it.each([
    ['OAuth user', { discord: { ...dependencies().deps.discord, getCurrentUser: vi.fn(async () => ({ id: 'user-2' })) } }, 'oauth_principal_mismatch'],
    ['PKCE state', { oauth: { begin: vi.fn(), verifyAndConsume: vi.fn(() => undefined) } }, 'oauth_state_invalid'],
    ['launch replay', { launches: { findByStateId: vi.fn(() => launch), consume: vi.fn(() => undefined) } }, 'launch_state_invalid'],
  ])('fails closed when %s validation fails', async (_label, override, code) => {
    const { deps, createSession } = dependencies(override as Partial<ActivityBootstrapDependencies>);
    await expect(createActivityBootstrapService(deps).bootstrap({
      state: launch.stateId,
      instanceId: instance.instanceId,
      code: 'authorization-code',
      codeVerifier: verifier,
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
    })).rejects.toEqual(expect.objectContaining({ code }));
    expect(createSession).not.toHaveBeenCalled();
  });
});
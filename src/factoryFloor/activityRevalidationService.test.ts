import { describe, expect, it, vi } from 'vitest';
import {
  createActivityRevalidationService,
  type ActivityRevalidationDependencies,
  type ActivityRevalidationMemberResolution,
  type ActivityRevalidationRequest,
} from './activityRevalidationService.js';
import { DiscordActivityApiError } from './discordOAuthClient.js';

const request: ActivityRevalidationRequest = {
  applicationId: 'application-1',
  instanceId: 'i-launch-1-gc-guild-1-thread-1',
  installationId: 'guild-1',
  guildId: 'guild-1',
  channelId: 'agent-1',
  threadId: 'thread-1',
  principalId: 'user-1',
  adapter: 'discord-agent',
  projectId: 'ff-project-1',
  runId: 'run-1',
  action: 'approve',
};

const instance = {
  applicationId: 'application-1',
  instanceId: request.instanceId,
  launchId: 'launch-1',
  location: {
    id: 'gc-guild-1-thread-1',
    kind: 'gc' as const,
    guildId: 'guild-1',
    channelId: 'thread-1',
  },
  users: ['user-1'],
};

function dependencies(overrides: Partial<ActivityRevalidationDependencies> = {}) {
  const deps: ActivityRevalidationDependencies = {
    applicationId: 'application-1',
    guildId: 'guild-1',
    adapter: 'discord-agent',
    timeoutMs: 1_000,
    maxRequests: 10,
    rateLimitWindowMs: 60_000,
    now: () => 2_000,
    discord: {
      getActivityInstance: vi.fn(async () => instance),
    },
    bindings: {
      findProjectByFactoryFloorId: vi.fn(() => ({
        projectName: 'factory-floor',
        factoryFloorProjectId: 'ff-project-1',
        guildId: 'guild-1',
        createdAt: 1_000,
        updatedAt: 1_000,
      })),
      findSurfaceByActivityInstance: vi.fn(() => ({
        id: 'surface-1',
        projectName: 'factory-floor',
        guildId: 'guild-1',
        channelId: 'agent-1',
        threadId: 'thread-1',
        activityInstanceId: request.instanceId,
        createdAt: 1_000,
        updatedAt: 1_000,
      })),
      findRun: vi.fn(() => ({
        runId: 'run-1',
        projectName: 'factory-floor',
        surfaceId: 'surface-1',
        createdAt: 1_000,
        updatedAt: 1_000,
      })),
    },
    resolveMember: vi.fn(async () => ({
      kind: 'member' as const,
      userId: 'user-1',
      authorized: true,
    })),
    ...overrides,
  };
  return deps;
}

describe('ActivityRevalidationService', () => {
  it('allows an action only after live instance, binding, membership, and role revalidation', async () => {
    const deps = dependencies();

    await expect(createActivityRevalidationService(deps).revalidate(request)).resolves.toEqual({
      schemaVersion: 1,
      allowed: true,
      reasonCode: 'authorized',
      action: 'approve',
      principalId: 'user-1',
      runId: 'run-1',
      revalidatedAt: 2_000,
    });

    expect(deps.discord.getActivityInstance).toHaveBeenCalledWith(request.instanceId);
    expect(deps.resolveMember).toHaveBeenCalledWith('guild-1', 'user-1', 'approve');
  });

  it.each([
    ['unsupported action', { action: 'delete' }, 'unsupported_action'],
    ['application', { applicationId: 'other' }, 'activity_application_mismatch'],
    ['installation', { installationId: 'other' }, 'installation_mismatch'],
    ['guild', { guildId: 'other' }, 'guild_mismatch'],
    ['adapter', { adapter: 'other' }, 'adapter_mismatch'],
  ])('denies %s mismatches before contacting Discord', async (_label, patch, reasonCode) => {
    const deps = dependencies();
    const result = await createActivityRevalidationService(deps).revalidate({
      ...request,
      ...patch,
    } as ActivityRevalidationRequest);
    const action = 'action' in patch ? patch.action : request.action;

    expect(result).toEqual({
      schemaVersion: 1,
      allowed: false,
      reasonCode,
      action,
      revalidatedAt: 2_000,
    });
    expect(deps.discord.getActivityInstance).not.toHaveBeenCalled();
  });

  it.each([
    ['application', { applicationId: 'other' }, 'activity_application_mismatch'],
    ['location', { location: { ...instance.location, channelId: 'other' } }, 'activity_location_mismatch'],
    ['participant', { users: ['other'] }, 'activity_principal_not_present'],
  ])('denies a live Activity %s mismatch', async (_label, patch, reasonCode) => {
    const deps = dependencies({
      discord: {
        getActivityInstance: vi.fn(async () => ({ ...instance, ...patch })),
      },
    });

    await expect(createActivityRevalidationService(deps).revalidate(request)).resolves.toMatchObject({
      allowed: false,
      reasonCode,
    });
  });

  it.each([
    ['removed member', { kind: 'missing' as const }, 'member_not_found'],
    ['Discord membership unavailable', { kind: 'unavailable' as const }, 'member_unavailable'],
    ['changed roles', { kind: 'member' as const, userId: 'user-1', authorized: false }, 'not_authorized'],
    ['wrong principal', { kind: 'member' as const, userId: 'other', authorized: true }, 'principal_mismatch'],
  ])('fails closed for %s', async (_label, member, reasonCode) => {
    const deps = dependencies({ resolveMember: vi.fn(async () => member) });

    await expect(createActivityRevalidationService(deps).revalidate(request)).resolves.toMatchObject({
      allowed: false,
      reasonCode,
    });
  });

  it.each([
    ['missing project', { findProjectByFactoryFloorId: vi.fn(() => undefined) }, 'project_binding_not_found'],
    ['missing surface', { findSurfaceByActivityInstance: vi.fn(() => undefined) }, 'surface_binding_not_found'],
    ['missing run', { findRun: vi.fn(() => undefined) }, 'run_binding_not_found'],
    ['wrong run surface', { findRun: vi.fn(() => ({ runId: 'run-1', projectName: 'factory-floor', surfaceId: 'other', createdAt: 1, updatedAt: 1 })) }, 'binding_mismatch'],
  ])('denies %s', async (_label, bindingOverride, reasonCode) => {
    const base = dependencies();
    const deps = dependencies({
      bindings: { ...base.bindings, ...bindingOverride },
    });

    await expect(createActivityRevalidationService(deps).revalidate(request)).resolves.toMatchObject({
      allowed: false,
      reasonCode,
    });
  });

  it('maps a revoked Activity instance without leaking Discord details', async () => {
    const deps = dependencies({
      discord: {
        getActivityInstance: vi.fn(async () => {
          throw new DiscordActivityApiError('not_found', 'sensitive discord response', 404);
        }),
      },
    });

    await expect(createActivityRevalidationService(deps).revalidate(request)).resolves.toEqual({
      schemaVersion: 1,
      allowed: false,
      reasonCode: 'activity_instance_not_found',
      action: 'approve',
      revalidatedAt: 2_000,
    });
  });

  it('rate-limits by principal and action before repeating upstream work', async () => {
    const deps = dependencies({ maxRequests: 1 });
    const service = createActivityRevalidationService(deps);

    await expect(service.revalidate(request)).resolves.toMatchObject({ allowed: true });
    await expect(service.revalidate(request)).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'rate_limited',
    });
    expect(deps.discord.getActivityInstance).toHaveBeenCalledTimes(1);
  });

  it('fails closed when current membership resolution exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies({
        timeoutMs: 25,
        resolveMember: vi.fn(() => new Promise<ActivityRevalidationMemberResolution>(() => undefined)),
      });
      const result = createActivityRevalidationService(deps).revalidate(request);
      await vi.advanceTimersByTimeAsync(25);

      await expect(result).resolves.toMatchObject({
        allowed: false,
        reasonCode: 'member_unavailable',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

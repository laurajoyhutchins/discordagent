import { describe, expect, it, vi } from 'vitest';
import type {
  FactoryFloorProjectBinding,
  FactoryFloorRunBinding,
  FactoryFloorSurfaceBinding,
} from '../repositories/factoryFloorBindingRepository.js';
import type { Project } from '../types.js';
import {
  createFactoryFloorActivityLaunchService,
  type FactoryFloorActivityLaunchDependencies,
  type TrustedActivityLaunchRequest,
} from './activityLaunchService.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
};

const projectBinding: FactoryFloorProjectBinding = {
  projectName: project.name,
  factoryFloorProjectId: 'ff-project-1',
  guildId: 'guild-1',
  createdAt: 1,
  updatedAt: 1,
};

const threadSurface: FactoryFloorSurfaceBinding = {
  id: 'surface-thread-1',
  projectName: project.name,
  guildId: 'guild-1',
  channelId: 'agent-1',
  threadId: 'thread-1',
  createdAt: 1,
  updatedAt: 1,
};

const threadRun: FactoryFloorRunBinding = {
  runId: 'run-1',
  projectName: project.name,
  surfaceId: threadSurface.id,
  createdAt: 1,
  updatedAt: 1,
};

function request(overrides: Partial<TrustedActivityLaunchRequest> = {}): TrustedActivityLaunchRequest {
  return {
    interactionId: 'interaction-1',
    applicationId: 'application-1',
    installationType: 'guild',
    installationOwnerId: 'guild-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    principalId: 'user-1',
    authorized: true,
    ...overrides,
  };
}

function dependencies(overrides: Partial<FactoryFloorActivityLaunchDependencies> = {}) {
  const create = vi.fn((input: Record<string, unknown>) => input);
  const deps: FactoryFloorActivityLaunchDependencies = {
    expectedApplicationId: 'application-1',
    expectedGuildId: 'guild-1',
    findProjectByChannelId: channelId => channelId === 'agent-1' ? project : undefined,
    bindings: {
      findProjectByName: name => name === project.name ? projectBinding : undefined,
      findSurfaceByThread: (_guildId, channelId, threadId) => (
        channelId === 'agent-1' && threadId === 'thread-1' ? threadSurface : undefined
      ),
      findActiveRunBySurface: surfaceId => surfaceId === threadSurface.id ? threadRun : undefined,
      listActiveRunsByProject: () => [],
    },
    launches: { create, invalidate: vi.fn() },
    now: () => 1_000,
    generateStateId: () => 'opaque-state-1',
    launchTtlMs: 120_000,
    ...overrides,
  };
  return { deps, create };
}

describe('Factory Floor trusted Activity launch resolution', () => {
  it.each([
    ['unauthorized principal', request({ authorized: false }), 'not_authorized'],
    ['wrong application', request({ applicationId: 'application-other' }), 'application_mismatch'],
    ['non-guild installation', request({ installationType: 'user' }), 'installation_mismatch'],
    ['wrong installation owner', request({ installationOwnerId: 'guild-other' }), 'installation_mismatch'],
    ['wrong guild', request({ guildId: 'guild-other', installationOwnerId: 'guild-other' }), 'guild_mismatch'],
  ])('fails closed for %s', async (_label, input, code) => {
    const { deps, create } = dependencies();
    const service = createFactoryFloorActivityLaunchService(deps);

    await expect(service.prepare(input)).resolves.toEqual(expect.objectContaining({
      ok: false,
      code,
    }));
    expect(create).not.toHaveBeenCalled();
  });

  it('creates project-context state from an eligible bound project channel with no active runs', async () => {
    const { deps, create } = dependencies();
    const service = createFactoryFloorActivityLaunchService(deps);

    await expect(service.prepare(request())).resolves.toEqual({
      ok: true,
      stateId: 'opaque-state-1',
      contextKind: 'project',
      projectName: 'factory-floor',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      stateId: 'opaque-state-1',
      interactionId: 'interaction-1',
      applicationId: 'application-1',
      installationType: 'guild',
      installationOwnerId: 'guild-1',
      guildId: 'guild-1',
      channelId: 'agent-1',
      threadId: undefined,
      principalId: 'user-1',
      projectName: 'factory-floor',
      factoryFloorProjectId: 'ff-project-1',
      surfaceId: undefined,
      runId: undefined,
      contextKind: 'project',
      createdAt: 1_000,
      expiresAt: 121_000,
    }));
  });

  it('selects the sole active run from a project channel and rejects ambiguous candidates', async () => {
    const single = dependencies({
      bindings: {
        findProjectByName: () => projectBinding,
        findSurfaceByThread: () => undefined,
        findActiveRunBySurface: () => undefined,
        listActiveRunsByProject: () => [threadRun],
      },
    });
    await expect(createFactoryFloorActivityLaunchService(single.deps).prepare(request()))
      .resolves.toEqual(expect.objectContaining({
        ok: true,
        contextKind: 'run',
        runId: 'run-1',
      }));

    const ambiguous = dependencies({
      bindings: {
        findProjectByName: () => projectBinding,
        findSurfaceByThread: () => undefined,
        findActiveRunBySurface: () => undefined,
        listActiveRunsByProject: () => [
          threadRun,
          { ...threadRun, runId: 'run-2', surfaceId: 'surface-2' },
        ],
      },
    });
    await expect(createFactoryFloorActivityLaunchService(ambiguous.deps).prepare(request()))
      .resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'ambiguous_run',
      }));
    expect(ambiguous.create).not.toHaveBeenCalled();
  });

  it('requires an exact bound run for a task thread and binds the full server context', async () => {
    const { deps, create } = dependencies();
    const service = createFactoryFloorActivityLaunchService(deps);

    await expect(service.prepare(request({ threadId: 'thread-1' }))).resolves.toEqual({
      ok: true,
      stateId: 'opaque-state-1',
      contextKind: 'run',
      projectName: 'factory-floor',
      runId: 'run-1',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'agent-1',
      threadId: 'thread-1',
      surfaceId: 'surface-thread-1',
      runId: 'run-1',
      contextKind: 'run',
    }));
  });

  it.each([
    ['unregistered project channel', { findProjectByChannelId: () => undefined }, 'project_unavailable'],
    ['unbound project', { bindings: {
      findProjectByName: () => undefined,
      findSurfaceByThread: () => undefined,
      findActiveRunBySurface: () => undefined,
      listActiveRunsByProject: () => [],
    } }, 'project_unbound'],
    ['unbound task thread', { bindings: {
      findProjectByName: () => projectBinding,
      findSurfaceByThread: () => undefined,
      findActiveRunBySurface: () => undefined,
      listActiveRunsByProject: () => [],
    } }, 'surface_unbound'],
    ['task thread without active run', { bindings: {
      findProjectByName: () => projectBinding,
      findSurfaceByThread: () => threadSurface,
      findActiveRunBySurface: () => undefined,
      listActiveRunsByProject: () => [],
    } }, 'run_unavailable'],
  ])('fails with actionable state for %s', async (_label, override, code) => {
    const { deps, create } = dependencies(override as Partial<FactoryFloorActivityLaunchDependencies>);
    const service = createFactoryFloorActivityLaunchService(deps);
    const input = code === 'surface_unbound' || code === 'run_unavailable'
      ? request({ threadId: 'thread-1' })
      : request();

    await expect(service.prepare(input)).resolves.toEqual(expect.objectContaining({
      ok: false,
      code,
    }));
    expect(create).not.toHaveBeenCalled();
  });

  it('fails when a project binding belongs to another guild', async () => {
    const { deps, create } = dependencies({
      bindings: {
        findProjectByName: () => ({ ...projectBinding, guildId: 'guild-other' }),
        findSurfaceByThread: () => undefined,
        findActiveRunBySurface: () => undefined,
        listActiveRunsByProject: () => [],
      },
    });

    await expect(createFactoryFloorActivityLaunchService(deps).prepare(request()))
      .resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'binding_mismatch',
      }));
    expect(create).not.toHaveBeenCalled();
  });
});

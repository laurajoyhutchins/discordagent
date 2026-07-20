import { expect, it, vi } from 'vitest';
import {
  createActivityBootstrapSessionClient,
} from './activityBootstrapSessionClient.js';

const request = {
  applicationId: 'application-1',
  instanceId: 'instance-1',
  installationId: 'guild-1',
  guildId: 'guild-1',
  channelId: 'agent-1',
  threadId: 'thread-1',
  launchId: 'launch-1',
  principalId: 'user-1',
  adapter: 'discord-agent',
  boundRunId: 'run-1',
};

it('attaches the fully validated Activity instance before session issuance', async () => {
  const bind = vi.fn();
  const createSession = vi.fn(async () => ({
    instanceBindingId: 'binding-1',
    sessionToken: 'factory-floor-session',
    expiresAt: '2026-07-20T01:00:00.000Z',
    idleExpiresAt: '2026-07-20T00:40:00.000Z',
  }));
  const client = createActivityBootstrapSessionClient({
    bindings: {
      findRun: vi.fn(() => ({
        runId: 'run-1',
        projectName: 'factory-floor',
        surfaceId: 'surface-1',
        createdAt: 1_000,
        updatedAt: 1_000,
      })),
    },
    activityInstances: { bind },
    factoryFloor: { createOrJoinActivitySession: createSession },
  });

  await expect(client.createOrJoinActivitySession(request)).resolves.toMatchObject({
    instanceBindingId: 'binding-1',
  });

  expect(bind).toHaveBeenCalledWith('surface-1', 'instance-1');
  expect(bind.mock.invocationCallOrder[0]).toBeLessThan(
    createSession.mock.invocationCallOrder[0]!,
  );
});

it('fails closed before session issuance when the bound run is no longer active', async () => {
  const bind = vi.fn();
  const createSession = vi.fn();
  const client = createActivityBootstrapSessionClient({
    bindings: { findRun: vi.fn(() => undefined) },
    activityInstances: { bind },
    factoryFloor: { createOrJoinActivitySession: createSession },
  });

  await expect(client.createOrJoinActivitySession(request)).rejects.toThrow(
    'factory_floor_run_binding_unavailable',
  );
  expect(bind).not.toHaveBeenCalled();
  expect(createSession).not.toHaveBeenCalled();
});

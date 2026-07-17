import { describe, expect, it, vi } from 'vitest';
import { FactoryFloorBridgeService } from './bridgeService.js';
import type { FactoryFloorRunBinding } from '../repositories/factoryFloorRunRepository.js';

function binding(status: FactoryFloorRunBinding['status'] = 'running'): FactoryFloorRunBinding {
  return {
    runId: 'run-1',
    projectName: 'factory-floor',
    repository: 'owner/repo',
    objective: 'Implement the Discord bridge',
    requestedBy: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    threadId: 'thread-1',
    statusMessageId: 'message-1',
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

function setup() {
  let current = binding();
  const edit = vi.fn(async () => undefined);
  const api = {
    getRun: vi.fn(async () => ({
      runId: 'run-1',
      status: 'completed' as const,
      counts: { queued: 0, active: 0, completed: 1, failed: 0, cancelled: 0 },
      terminalResultSummary: 'completed',
    })),
    getStatus: vi.fn(),
    submitTask: vi.fn(),
    cancelRun: vi.fn(async () => ({})),
    listApprovals: vi.fn(async () => []),
    decideApproval: vi.fn(async () => ({})),
  };
  const runs = {
    create: vi.fn(),
    findByRunId: vi.fn(() => current),
    findByThreadId: vi.fn(),
    listActive: vi.fn(() => [current]),
    updateStatus: vi.fn((_runId: string, status: FactoryFloorRunBinding['status']) => {
      current = { ...current, status, updatedAt: 2, ...(status === 'completed' ? { terminalAt: 2 } : {}) };
      return current;
    }),
    recordError: vi.fn((_runId: string, message: string) => ({ ...current, lastError: message })),
  };
  const discord = {
    channels: {
      fetch: vi.fn(async () => ({
        isTextBased: () => true,
        messages: { fetch: vi.fn(async () => ({ edit })) },
      })),
    },
  };
  return {
    service: new FactoryFloorBridgeService(api as never, runs as never, discord as never, {
      pollingEnabled: false,
    }),
    api,
    runs,
    edit,
  };
}

describe('FactoryFloorBridgeService', () => {
  it('refreshes active bindings from canonical Factory Floor state on startup', async () => {
    const context = setup();
    await context.service.start();

    expect(context.api.getRun).toHaveBeenCalledWith('discord-agent:poller', 'run-1');
    expect(context.runs.updateStatus).toHaveBeenCalledWith('run-1', 'completed');
    expect(context.edit).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: expect.any(Array),
    }));
  });

  it('attributes cancellation to the initiating Discord user and refreshes the card', async () => {
    const context = setup();
    await context.service.cancelRun('run-1', 'user-1', 'interaction-1');

    expect(context.api.cancelRun).toHaveBeenCalledWith('discord:user-1', 'run-1', {
      clientRequestId: 'interaction-1',
      reason: 'Cancelled by Discord user user-1.',
    });
    expect(context.api.getRun).toHaveBeenCalledWith('discord:user-1', 'run-1');
  });
});

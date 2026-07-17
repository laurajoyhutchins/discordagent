import { describe, expect, it, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { TaskResult } from '../agents/contracts.js';
import type { TaskRecord } from '../types.js';
process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';

const { handleTaskControlButton } = await import('./taskControlHandler.js');

const task: TaskRecord = {
  id: 'task-1',
  projectName: 'factory-floor',
  provider: 'codex',
  status: 'running',
  channelId: 'agent-1',
  threadId: 'thread-1',
  objective: 'Implement generic Discord task controls',
  createdAt: 1,
  updatedAt: 2,
};

const result: TaskResult = {
  provider: 'codex',
  outcome: 'completed',
  exitType: 'success',
  startedAt: 1,
  completedAt: 3,
  summary: 'Implemented the controls.',
  verification: ['npm test: passed'],
};

function interaction(customId: string, channelId = 'thread-1') {
  const channel = { id: channelId, isThread: () => true };
  return {
    customId,
    channel,
    user: { id: 'user-1' },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'member-1' })) } },
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ButtonInteraction & {
    reply: ReturnType<typeof vi.fn>;
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
  };
}

function dependencies(options: { authorized?: boolean; current?: TaskRecord; cancelResult?: boolean } = {}) {
  let current = options.current ?? task;
  const cancelByThread = vi.fn(async () => {
    if (options.cancelResult === false) return false;
    current = { ...current, status: 'cancelled', completedAt: 4, updatedAt: 4 };
    return true;
  });
  const update = vi.fn(async () => undefined);
  return {
    tasks: {
      findById: vi.fn(() => current),
      getResult: vi.fn(() => result),
    },
    coordinator: { cancelByThread },
    controlSurface: { update },
    isAuthorized: () => options.authorized ?? true,
  };
}

describe('task control buttons', () => {
  it('ignores component IDs that do not belong to the generic task controls', async () => {
    const value = interaction('agent:approval:allow');
    const deps = dependencies();

    await expect(handleTaskControlButton(value, deps)).resolves.toBe(false);
    expect(value.reply).not.toHaveBeenCalled();
  });

  it('inspects the durable task and result in an ephemeral response', async () => {
    const value = interaction('task-control:inspect:task-1');
    const deps = dependencies();

    await expect(handleTaskControlButton(value, deps)).resolves.toBe(true);

    expect(value.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Implemented the controls.'),
      ephemeral: true,
    }));
    expect(deps.coordinator.cancelByThread).not.toHaveBeenCalled();
  });

  it('cancels only the task bound to the current Discord thread and refreshes its card', async () => {
    const value = interaction('task-control:cancel:task-1');
    const deps = dependencies();

    await expect(handleTaskControlButton(value, deps)).resolves.toBe(true);

    expect(value.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(deps.coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
    expect(deps.controlSurface.update).toHaveBeenCalledWith(
      value.channel,
      expect.objectContaining({ status: 'cancelled' }),
      result,
    );
    expect(value.editReply).toHaveBeenCalledWith('Task cancelled.');
  });

  it('reports successful cancellation even when the Discord card refresh fails', async () => {
    const value = interaction('task-control:cancel:task-1');
    const deps = dependencies();
    deps.controlSurface.update.mockRejectedValueOnce(new Error('Discord unavailable'));

    await handleTaskControlButton(value, deps);

    expect(deps.coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
    expect(value.editReply).toHaveBeenCalledWith('Task cancelled.');
  });

  it('rejects unauthorized and cross-thread actions before mutation', async () => {
    const unauthorized = interaction('task-control:cancel:task-1');
    const unauthorizedDeps = dependencies({ authorized: false });
    await handleTaskControlButton(unauthorized, unauthorizedDeps);
    expect(unauthorizedDeps.coordinator.cancelByThread).not.toHaveBeenCalled();

    const wrongThread = interaction('task-control:cancel:task-1', 'thread-2');
    const wrongThreadDeps = dependencies();
    await handleTaskControlButton(wrongThread, wrongThreadDeps);
    expect(wrongThreadDeps.coordinator.cancelByThread).not.toHaveBeenCalled();
    expect(wrongThread.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('does not offer cancellation for terminal tasks', async () => {
    const completed = { ...task, status: 'completed' as const, completedAt: 3 };
    const value = interaction('task-control:cancel:task-1');
    const deps = dependencies({ current: completed });

    await handleTaskControlButton(value, deps);

    expect(deps.coordinator.cancelByThread).not.toHaveBeenCalled();
    expect(value.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('already completed'),
      ephemeral: true,
    }));
  });
});

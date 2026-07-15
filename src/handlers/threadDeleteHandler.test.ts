import { describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { handleThreadDelete } from './threadDeleteHandler.js';

describe('threadDeleteHandler', () => {
  it('cancels the durable task while preserving coordinator-managed worktree state', async () => {
    const coordinator = {
      cancelByThread: vi.fn(async () => true),
    } as unknown as TaskCoordinator;

    await handleThreadDelete({ id: 'thread-1' } as AnyThreadChannel, coordinator);

    expect(coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { handleThreadDelete } from './threadDeleteHandler.js';

describe('threadDeleteHandler', () => {
  it('cancels the durable task and terminalizes the durable loop for the deleted thread', async () => {
    const coordinator = {
      cancelByThread: vi.fn(async () => true),
    } as unknown as TaskCoordinator;
    const terminalizeLoop = vi.fn(() => ({ id: 'loop-1' }));

    await handleThreadDelete(
      { id: 'thread-1' } as AnyThreadChannel,
      coordinator,
      terminalizeLoop,
    );

    expect(coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
    expect(terminalizeLoop).toHaveBeenCalledWith(
      'thread-1',
      'Discord loop thread deleted',
    );
  });

  it('keeps task and loop cleanup independent and idempotent', async () => {
    const coordinator = {
      cancelByThread: vi.fn(async () => false),
    } as unknown as TaskCoordinator;
    const terminalizeLoop = vi.fn(() => undefined);

    await expect(handleThreadDelete(
      { id: 'thread-missing' } as AnyThreadChannel,
      coordinator,
      terminalizeLoop,
    )).resolves.toBeUndefined();

    expect(coordinator.cancelByThread).toHaveBeenCalledOnce();
    expect(terminalizeLoop).toHaveBeenCalledOnce();
  });
});

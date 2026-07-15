import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';
import { handleCancel } from './cancel.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
};

function interaction(thread: boolean) {
  return {
    channelId: thread ? 'thread-1' : 'agent-1',
    channel: { isThread: () => thread },
    reply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

function dependencies(cancelled: boolean, loopIterations: number | null = null) {
  return {
    coordinator: {
      cancelByThread: vi.fn(async () => cancelled),
    } as unknown as TaskCoordinator & { cancelByThread: ReturnType<typeof vi.fn> },
    getProjectByChannel: (channelId: string) => channelId === 'agent-1' ? project : undefined,
    cancelLoop: vi.fn(() => loopIterations),
    getLoopChannelForThread: vi.fn((threadId: string) => threadId === 'thread-1' ? 'agent-1' : undefined),
  };
}

describe('/cancel', () => {
  it('cancels the durable task and loop associated with a task thread', async () => {
    const command = interaction(true);
    const deps = dependencies(true, 2);

    await handleCancel(command, deps);

    expect(deps.coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
    expect(deps.cancelLoop).toHaveBeenCalledWith('agent-1');
    expect(command.reply).toHaveBeenCalledWith(expect.stringMatching(/task cancelled/i));
    expect(command.reply).toHaveBeenCalledWith(expect.stringMatching(/stopped loop/i));
  });

  it('reports when a thread has no active task or loop', async () => {
    const command = interaction(true);
    const deps = dependencies(false, null);
    deps.getLoopChannelForThread = vi.fn(() => undefined);

    await handleCancel(command, deps);

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/no active task or loop/i),
      ephemeral: true,
    }));
  });

  it('only stops the project loop from the main channel and directs task cancellation to threads', async () => {
    const command = interaction(false);
    const deps = dependencies(false, 3);

    await handleCancel(command, deps);

    expect(deps.coordinator.cancelByThread).not.toHaveBeenCalled();
    expect(deps.cancelLoop).toHaveBeenCalledWith('agent-1');
    expect(command.reply).toHaveBeenCalledWith(expect.stringMatching(/task thread/i));
  });
});

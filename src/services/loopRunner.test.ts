import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { AnyThreadChannel, Message } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';

const {
  startLoop,
  stopAllLoops,
} = await import('./loopRunner.js');

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
  models: { claude: 'sonnet' },
};

afterEach(() => stopAllLoops());

function setup() {
  const thread = {
    id: 'loop-thread-1',
    parentId: 'agent-1',
    send: vi.fn(async () => ({ id: 'message-1' })),
    setName: vi.fn(async () => undefined),
  } as unknown as AnyThreadChannel;
  const message = {
    channel: { type: ChannelType.GuildText },
    author: { id: 'user-1' },
    startThread: vi.fn(async () => thread),
    reply: vi.fn(async () => undefined),
  } as unknown as Message & {
    startThread: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
  const coordinator = {
    startInExistingThread: vi.fn(async () => ({ id: 'task-1' })),
    continueInThread: vi.fn(async () => undefined),
  } as unknown as TaskCoordinator & {
    startInExistingThread: ReturnType<typeof vi.fn>;
    continueInThread: ReturnType<typeof vi.fn>;
  };
  const scheduled: Array<() => Promise<void>> = [];
  const schedule = vi.fn((callback: () => Promise<void>) => {
    scheduled.push(callback);
    return 1 as unknown as ReturnType<typeof setTimeout>;
  });
  return { thread, message, coordinator, scheduled, schedule };
}

describe('loopRunner durable task reuse', () => {
  it('starts one durable task and continues the same thread on later iterations', async () => {
    const { thread, message, coordinator, scheduled, schedule } = setup();

    await startLoop(60_000, 'run the tests', project, message, { coordinator, schedule });

    expect(coordinator.startInExistingThread).toHaveBeenCalledWith({
      projectName: 'factory-floor',
      prompt: 'run the tests',
      thread,
      provider: 'claude',
      model: 'sonnet',
    });
    expect(coordinator.continueInThread).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);

    await scheduled[0]();

    expect(coordinator.continueInThread).toHaveBeenCalledWith({
      prompt: 'run the tests',
      thread,
    });
    expect(coordinator.startInExistingThread).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('does not schedule the next iteration until the current continuation finishes', async () => {
    const { message, coordinator, scheduled, schedule } = setup();
    let resolveContinuation!: () => void;
    coordinator.continueInThread.mockImplementation(() => new Promise<void>(resolve => {
      resolveContinuation = resolve;
    }));

    await startLoop(60_000, 'run the tests', project, message, { coordinator, schedule });
    const secondIteration = scheduled[0]();
    await vi.waitFor(() => expect(coordinator.continueInThread).toHaveBeenCalledTimes(1));
    expect(schedule).toHaveBeenCalledTimes(1);

    resolveContinuation();
    await secondIteration;
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});

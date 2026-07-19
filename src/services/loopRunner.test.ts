import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
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
  stopLoop,
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

function addChannelCapabilities(
  target: object,
  permissions: readonly bigint[],
): void {
  const candidate = target as { id?: string; isThread?: () => boolean };
  const member = { permissions: new PermissionsBitField(permissions) };
  Object.assign(target, {
    id: candidate.id ?? 'channel-1',
    guild: { members: { me: member } },
    parent: null,
    permissionsFor: () => new PermissionsBitField(permissions),
    isThread: candidate.isThread ?? (() => false),
  });
}

function setup() {
  const thread = {
    id: 'loop-thread-1',
    parentId: 'agent-1',
    send: vi.fn(async () => ({ id: 'message-1' })),
    setName: vi.fn(async () => undefined),
  } as unknown as AnyThreadChannel & {
    send: ReturnType<typeof vi.fn>;
    setName: ReturnType<typeof vi.fn>;
  };
  const channel = { type: ChannelType.GuildText };
  const message = {
    channel,
    author: { id: 'user-1' },
    startThread: vi.fn(async () => thread),
    reply: vi.fn(async () => undefined),
  } as unknown as Message & {
    channel: typeof channel;
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
  return { thread, channel, message, coordinator, scheduled, schedule };
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

describe('loopRunner capability-aware presentation', () => {
  it('uses text for start, iteration, and waiting states when embeds are unavailable', async () => {
    const { thread, message, coordinator, schedule } = setup();
    addChannelCapabilities(thread, [PermissionFlagsBits.SendMessagesInThreads]);

    await startLoop(60_000, 'run the tests', project, message, { coordinator, schedule });

    const payloads = thread.send.mock.calls.map(([payload]) => payload as {
      content?: string;
      components?: unknown[];
    });
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringMatching(/Loop started.*run the tests.*1m/s),
        components: expect.any(Array),
      }),
      expect.objectContaining({ content: expect.stringMatching(/Iteration #1/) }),
      expect.objectContaining({
        content: expect.stringMatching(/Iteration #1 complete.*Next iteration/s),
        components: expect.any(Array),
      }),
    ]));
  });

  it('retries each lifecycle state as text after Discord rejects its embed', async () => {
    const { thread, message, coordinator, schedule } = setup();
    addChannelCapabilities(thread, [
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.EmbedLinks,
    ]);
    thread.send.mockImplementation(async (payload: { embeds?: unknown[] }) => {
      if (payload.embeds?.length) throw new Error('Missing Permissions: Embed Links');
      return { id: 'message-1' };
    });

    await startLoop(60_000, 'run the tests', project, message, { coordinator, schedule });

    const payloads = thread.send.mock.calls.map(([payload]) => payload as {
      content?: string;
      embeds?: unknown[];
      components?: unknown[];
    });
    expect(payloads.filter(payload => payload.embeds?.length)).toHaveLength(3);
    const fallbacks = payloads.filter(payload => payload.content);
    expect(fallbacks).toHaveLength(3);
    expect(fallbacks[0]).toEqual(expect.objectContaining({ components: expect.any(Array) }));
    expect(fallbacks[2]).toEqual(expect.objectContaining({ components: expect.any(Array) }));
  });

  it('does not start a hidden loop when neither rich nor text startup can be delivered', async () => {
    const { thread, message, coordinator, schedule } = setup();
    const logger = vi.fn();
    addChannelCapabilities(thread, [
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.EmbedLinks,
    ]);
    thread.send.mockRejectedValue(new Error('Cannot send messages'));

    await startLoop(60_000, 'run the tests', project, message, {
      coordinator,
      schedule,
      logger,
    });

    expect(coordinator.startInExistingThread).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/plain-text fallback failed/i));
  });

  it('uses a bounded text stopped state when the command surface cannot embed', async () => {
    const { thread, channel, message, coordinator, schedule } = setup();
    addChannelCapabilities(thread, [
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.EmbedLinks,
    ]);
    addChannelCapabilities(channel, [PermissionFlagsBits.SendMessages]);

    await startLoop(60_000, 'run the tests', project, message, { coordinator, schedule });
    await stopLoop(project.agentChannelId, message);

    expect(message.reply).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringMatching(/Loop stopped.*run the tests.*Iterations completed/s),
    }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';

const { handleMessage } = await import('./messageHandler.js');

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
  models: { claude: 'sonnet' },
};

function coordinator() {
  return {
    startFromMessage: vi.fn(async () => ({ id: 'task-1' })),
    continueFromMessage: vi.fn(async () => undefined),
  } as unknown as TaskCoordinator & {
    startFromMessage: ReturnType<typeof vi.fn>;
    continueFromMessage: ReturnType<typeof vi.fn>;
  };
}

function message(options: {
  content?: string;
  channelId?: string;
  thread?: boolean;
  parentId?: string | null;
}) {
  const thread = options.thread ?? false;
  return {
    author: { bot: false, id: 'user-1', tag: 'owner' },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'member-1' })) } },
    content: options.content ?? 'Implement the worker registry',
    createdTimestamp: Date.now(),
    channelId: options.channelId ?? (thread ? 'thread-1' : 'agent-1'),
    channel: {
      id: options.channelId ?? (thread ? 'thread-1' : 'agent-1'),
      parentId: options.parentId ?? (thread ? 'agent-1' : null),
      isThread: () => thread,
    },
    reply: vi.fn(async () => undefined),
  } as unknown as Message & { reply: ReturnType<typeof vi.fn> };
}

function dependencies(taskCoordinator: ReturnType<typeof coordinator>, authorized = true) {
  return {
    coordinator: taskCoordinator,
    getProjectByChannel: (channelId: string) => channelId === 'agent-1' ? project : undefined,
    updateProjectModel: vi.fn(),
    updateProjectProvider: vi.fn(),
    isAuthorized: () => authorized,
    defaultClaudeModel: '',
    startLoop: vi.fn(async () => undefined),
    stopLoop: vi.fn(async () => undefined),
    getLoopStatus: vi.fn(() => null),
    getLoopChannelForThread: vi.fn(() => undefined),
  };
}

describe('messageHandler coordinator routing', () => {
  it('starts a new provider-neutral task from the project channel', async () => {
    const taskCoordinator = coordinator();
    const input = message({});

    await handleMessage(input, dependencies(taskCoordinator));

    expect(taskCoordinator.startFromMessage).toHaveBeenCalledWith({
      projectName: 'factory-floor',
      prompt: 'Implement the worker registry',
      message: input,
      provider: 'claude',
      model: 'sonnet',
    });
    expect(taskCoordinator.continueFromMessage).not.toHaveBeenCalled();
  });

  it('continues the durable task associated with a Discord thread', async () => {
    const taskCoordinator = coordinator();
    const input = message({ thread: true });

    await handleMessage(input, dependencies(taskCoordinator));

    expect(taskCoordinator.continueFromMessage).toHaveBeenCalledWith({
      prompt: 'Implement the worker registry',
      message: input,
    });
    expect(taskCoordinator.startFromMessage).not.toHaveBeenCalled();
  });

  it('does not create work for an unauthorized member', async () => {
    const taskCoordinator = coordinator();
    const input = message({});

    await handleMessage(input, dependencies(taskCoordinator, false));

    expect(taskCoordinator.startFromMessage).not.toHaveBeenCalled();
    expect(input.reply).toHaveBeenCalledWith('You are not authorized to use this bot.');
  });


  it('redacts sensitive values from pickup logs', async () => {
    const taskCoordinator = coordinator();
    const input = message({ content: 'run with API_KEY=pickup-secret' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await handleMessage(input, dependencies(taskCoordinator));

      const output = log.mock.calls.flat().join(' ');
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('pickup-secret');
    } finally {
      log.mockRestore();
    }
  });

  it('redacts sensitive values from coordinator errors before replying', async () => {
    const taskCoordinator = coordinator();
    taskCoordinator.startFromMessage.mockRejectedValueOnce(
      new Error('Provider failed with API_KEY=reply-secret'),
    );
    const input = message({});

    await handleMessage(input, dependencies(taskCoordinator));

    const reply = JSON.stringify(input.reply.mock.calls[0]?.[0]);
    expect(reply).toContain('[REDACTED]');
    expect(reply).not.toContain('reply-secret');
  });

  it('renders structured coordinator errors as an embed instead of raw JSON', async () => {
    const taskCoordinator = coordinator();
    const rawError = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: 'The selected model is unavailable.' },
    });
    taskCoordinator.startFromMessage.mockRejectedValueOnce(new Error(rawError));
    const input = message({});

    await handleMessage(input, dependencies(taskCoordinator));

    const payload = input.reply.mock.calls[0]?.[0] as { embeds: Array<{ toJSON(): Record<string, unknown> }> };
    const rendered = JSON.stringify(payload.embeds[0].toJSON());
    expect(payload).toHaveProperty('embeds');
    expect(rendered).toContain('The selected model is unavailable.');
    expect(rendered).not.toContain(rawError);
  });

  it('ignores messages outside registered project channels', async () => {
    const taskCoordinator = coordinator();
    const input = message({ channelId: 'other-channel' });

    await handleMessage(input, dependencies(taskCoordinator));

    expect(taskCoordinator.startFromMessage).not.toHaveBeenCalled();
    expect(taskCoordinator.continueFromMessage).not.toHaveBeenCalled();
  });

  it('holds an unauthenticated Codex request without creating a thread or worktree', async () => {
    const taskCoordinator = coordinator();
    const input = message({});
    const codexProject = { ...project, defaultProvider: 'codex' as const, models: { codex: 'gpt-5.4' } };
    const deferPendingTask = vi.fn();
    const deps = {
      ...dependencies(taskCoordinator),
      getProjectByChannel: (channelId: string) => channelId === 'agent-1' ? codexProject : undefined,
      checkProvider: vi.fn(async () => ({ available: false, authenticationRequired: true, reason: 'Sign in required' })),
      deferPendingTask,
    };

    await handleMessage(input, deps);

    expect(taskCoordinator.startFromMessage).not.toHaveBeenCalled();
    expect(deferPendingTask).toHaveBeenCalledWith({
      userId: 'user-1', projectName: 'factory-floor', prompt: 'Implement the worker registry', message: input, model: 'gpt-5.4',
    });
    expect(input.reply).toHaveBeenCalledWith(expect.stringContaining('without creating a thread or worktree'));
  });

});

import { describe, expect, it, vi } from 'vitest';
import type { MessageContextMenuCommandInteraction } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';

const { handleTurnIntoTask } = await import('./turnIntoTask.js');
const { commands } = await import('./definitions.js');

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'codex',
  models: { codex: 'gpt-5.4' },
};

function interaction(options: {
  content?: string;
  channelId?: string;
  hasThread?: boolean;
  authorized?: boolean;
} = {}) {
  const thread = { id: 'thread-1' };
  const targetMessage = {
    id: 'message-1',
    content: options.content ?? 'Implement the worker registry',
    channelId: options.channelId ?? 'agent-1',
    hasThread: options.hasThread ?? false,
    thread: options.hasThread ? thread : null,
  };
  const value = {
    targetMessage,
    user: { id: 'user-1' },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'member-1' })) } },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  } as unknown as MessageContextMenuCommandInteraction & {
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
  return { value, targetMessage, authorized: options.authorized ?? true };
}

function dependencies(authorized: boolean) {
  const startFromMessage = vi.fn(async () => ({ threadId: 'thread-1' }));
  return {
    coordinator: { startFromMessage } as unknown as Pick<TaskCoordinator, 'startFromMessage'>,
    getProjectByChannel: (channelId: string) => channelId === project.agentChannelId ? project : undefined,
    isAuthorized: () => authorized,
  };
}

describe('Turn into task message command', () => {
  it('registers a Discord message context command', () => {
    expect(commands.map(command => command.toJSON())).toContainEqual(expect.objectContaining({
      name: 'Turn into task',
      type: 3,
    }));
  });

  it('starts a provider-neutral task from the selected project message', async () => {
    const { value, targetMessage } = interaction();
    const deps = dependencies(true);

    await handleTurnIntoTask(value, deps);

    expect(value.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(deps.coordinator.startFromMessage).toHaveBeenCalledWith({
      projectName: 'factory-floor',
      prompt: 'Implement the worker registry',
      message: targetMessage,
      provider: 'codex',
      model: 'gpt-5.4',
    });
    expect(value.editReply).toHaveBeenCalledWith('Task created: <#thread-1>');
  });

  it('rejects unauthorized invocations before task creation', async () => {
    const { value } = interaction();
    const deps = dependencies(false);

    await handleTurnIntoTask(value, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(value.reply).toHaveBeenCalledWith({ content: 'You are not authorized to use this bot.', ephemeral: true });
  });

  it('requires a registered project agent channel', async () => {
    const { value } = interaction({ channelId: 'general' });
    const deps = dependencies(true);

    await handleTurnIntoTask(value, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(value.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('rejects messages without text content', async () => {
    const { value } = interaction({ content: '   ' });
    const deps = dependencies(true);

    await handleTurnIntoTask(value, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(value.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('text') }));
  });

  it('does not create a duplicate task thread for a message that already has one', async () => {
    const { value } = interaction({ hasThread: true });
    const deps = dependencies(true);

    await handleTurnIntoTask(value, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(value.reply).toHaveBeenCalledWith({ content: 'This message already has a thread: <#thread-1>', ephemeral: true });
  });
});

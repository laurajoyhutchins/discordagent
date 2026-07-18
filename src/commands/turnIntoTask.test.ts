import { ApplicationCommandType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project, TaskRecord } from '../types.js';
import { commands } from './definitions.js';
import { handleTurnIntoTask, type TurnIntoTaskDependencies } from './turnIntoTask.js';

const project: Project = {
  name: 'discord-agent',
  workingDirectory: '/repo',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'opencode',
  models: { opencode: 'openai/gpt-5' },
};

const task: TaskRecord = {
  id: 'task-1',
  projectName: project.name,
  provider: 'opencode',
  status: 'starting',
  channelId: project.agentChannelId,
  threadId: 'thread-1',
  objective: 'Implement the feature',
  createdAt: 1,
  updatedAt: 1,
};

function makeInteraction(overrides: Partial<{
  channelId: string;
  content: string;
  hasThread: boolean;
  threadId: string;
}> = {}) {
  const targetMessage = {
    channelId: overrides.channelId ?? project.agentChannelId,
    content: overrides.content ?? '  Implement the feature  ',
    hasThread: overrides.hasThread ?? false,
    thread: overrides.threadId ? { id: overrides.threadId } : null,
  };
  return {
    user: { id: 'user-1' },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'member-1' })) } },
    targetMessage,
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as never;
}

function dependencies(overrides: Partial<TurnIntoTaskDependencies> = {}): TurnIntoTaskDependencies {
  return {
    coordinator: { startFromMessage: vi.fn(async () => task) } as Pick<TaskCoordinator, 'startFromMessage'>,
    getProjectByChannel: vi.fn(() => project),
    isAuthorized: vi.fn(() => true),
    ...overrides,
  };
}

describe('Turn into task', () => {
  it('registers a guild message context command', () => {
    const definition = commands.map(command => command.toJSON()).find(command => command.name === 'Turn into task');

    expect(definition).toMatchObject({
      name: 'Turn into task',
      type: ApplicationCommandType.Message,
    });
  });

  it('delegates exact message text through the coordinator without duplicating settings resolution', async () => {
    const interaction = makeInteraction();
    const deps = dependencies();

    await handleTurnIntoTask(interaction, deps);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(deps.coordinator.startFromMessage).toHaveBeenCalledWith({
      projectName: project.name,
      prompt: 'Implement the feature',
      message: interaction.targetMessage,
    });
    expect(interaction.editReply).toHaveBeenCalledWith('Task created: <#thread-1>');
  });

  it('rejects unauthorized users before creating a task', async () => {
    const interaction = makeInteraction();
    const deps = dependencies({ isAuthorized: vi.fn(() => false) });

    await handleTurnIntoTask(interaction, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/not authorized/i),
      ephemeral: true,
    }));
  });

  it('requires the selected message to be in the registered project agent channel', async () => {
    const interaction = makeInteraction({ channelId: 'other-channel' });
    const deps = dependencies({ getProjectByChannel: vi.fn(() => undefined) });

    await handleTurnIntoTask(interaction, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/registered project/i),
      ephemeral: true,
    }));
  });

  it('rejects empty message content', async () => {
    const interaction = makeInteraction({ content: '   ' });
    const deps = dependencies();

    await handleTurnIntoTask(interaction, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/text content/i),
      ephemeral: true,
    }));
  });

  it('rejects a message that already owns a thread', async () => {
    const interaction = makeInteraction({ hasThread: true, threadId: 'existing-thread' });
    const deps = dependencies();

    await handleTurnIntoTask(interaction, deps);

    expect(deps.coordinator.startFromMessage).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This message already has a thread: <#existing-thread>',
      ephemeral: true,
    });
  });
});
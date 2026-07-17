import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Project } from '../types.js';
import { handleModel } from './model.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
};

function interaction(input: { model?: string | null; custom?: string | null; thread?: boolean }) {
  return {
    channelId: input.thread ? 'thread-1' : 'agent-1',
    channel: { isThread: () => input.thread ?? false, parentId: 'agent-1' },
    user: { id: 'user-1' },
    options: {
      getString: vi.fn((name: string) => name === 'model' ? input.model ?? null : input.custom ?? null),
    },
    reply: vi.fn(async () => ({ awaitMessageComponent: vi.fn() })),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

describe('/model provider scoping', () => {
  it('stores a direct model override under the active provider', async () => {
    const update = vi.fn();
    const command = interaction({ model: 'sonnet' });

    await handleModel(command, {
      getProjectByChannel: () => project,
      updateProjectModel: update,
      defaultClaudeModel: '',
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'sonnet', 'claude');
  });

  it('rejects model changes inside an existing task thread', async () => {
    const update = vi.fn();
    const command = interaction({ custom: 'custom-model', thread: true });

    await handleModel(command, {
      getProjectByChannel: () => project,
      updateProjectModel: update,
      defaultClaudeModel: '',
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('stores an OpenCode model override under models.opencode', async () => {
    const update = vi.fn();
    const command = interaction({ custom: 'opencode/big-model' });

    await handleModel(command, {
      getProjectByChannel: () => ({ ...project, defaultProvider: 'opencode', models: { opencode: 'opencode/old-model' } }),
      updateProjectModel: update,
      defaultClaudeModel: '',
      defaultModels: { opencode: 'opencode/default-model' },
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'opencode/big-model', 'opencode');
  });

  it('uses the provider-scoped OpenCode default when no project override exists', async () => {
    const command = interaction({});

    await handleModel(command, {
      getProjectByChannel: () => ({ ...project, defaultProvider: 'opencode' }),
      updateProjectModel: vi.fn(),
      defaultClaudeModel: '',
      defaultModels: { opencode: 'opencode/default-model' },
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('opencode/default-model'),
    }));
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/OpenCode model/i),
    }));
  });
});

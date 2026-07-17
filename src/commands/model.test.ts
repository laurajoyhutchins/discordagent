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

function interaction(input: { model?: string | null; custom?: string | null; thinking?: string | null; thread?: boolean; channelName?: string }) {
  return {
    channelId: input.thread ? 'thread-1' : 'agent-1',
    channel: { isThread: () => input.thread ?? false, parentId: 'agent-1', name: input.channelName },
    user: { id: 'user-1' },
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'model') return input.model ?? null;
        if (name === 'custom') return input.custom ?? null;
        return input.thinking ?? null;
      }),
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
      updateProjectReasoning: vi.fn(),
      defaultClaudeModel: '',
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'sonnet', 'claude');
  });

  it('stores a Codex thinking depth from the slash command', async () => {
    const updateModel = vi.fn();
    const updateReasoning = vi.fn();
    const command = interaction({ thinking: 'xhigh' });
    const codexProject = { ...project, defaultProvider: 'codex' as const };

    await handleModel(command, {
      getProjectByChannel: () => codexProject,
      updateProjectModel: updateModel,
      updateProjectReasoning: updateReasoning,
      defaultClaudeModel: '',
    });

    expect(updateModel).not.toHaveBeenCalled();
    expect(updateReasoning).toHaveBeenCalledWith('factory-floor', 'xhigh', 'codex');
  });

  it('rejects model changes inside an existing task thread', async () => {
    const update = vi.fn();
    const command = interaction({ custom: 'custom-model', thread: true });

    await handleModel(command, {
      getProjectByChannel: () => project,
      updateProjectModel: update,
      updateProjectReasoning: vi.fn(),
      defaultClaudeModel: '',
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('does not pretend Claude supports the Codex thinking-depth setting', async () => {
    const updateReasoning = vi.fn();
    const command = interaction({ thinking: 'high' });

    await handleModel(command, {
      getProjectByChannel: () => project,
      updateProjectModel: vi.fn(),
      updateProjectReasoning: updateReasoning,
      defaultClaudeModel: '',
    });

    expect(updateReasoning).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/currently available for Codex/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('updates the global Codex PM model and thinking depth from agent-chat', async () => {
    const updateModel = vi.fn();
    const updateReasoning = vi.fn();
    const activate = vi.fn(async () => undefined);
    const command = interaction({ channelName: 'agent-chat', custom: 'gpt-5.6-luna', thinking: 'xhigh' });

    await handleModel(command, {
      getProjectByChannel: () => undefined,
      updateProjectModel: vi.fn(),
      updateProjectReasoning: vi.fn(),
      getDefaultProvider: () => 'codex',
      updateDefaultModel: updateModel,
      updateDefaultReasoning: updateReasoning,
      activateDefaultProvider: activate,
      defaultClaudeModel: '',
      defaultCodexModel: '',
    });

    expect(updateModel).toHaveBeenCalledWith('gpt-5.6-luna', 'codex');
    expect(updateReasoning).toHaveBeenCalledWith('xhigh', 'codex');
    expect(activate).toHaveBeenCalledWith('codex');
  });
});

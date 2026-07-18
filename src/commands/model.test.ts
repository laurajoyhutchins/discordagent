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
      settings: { updateProject: update, updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
    });

    expect(update).toHaveBeenCalledWith('factory-floor', { claudeModel: 'sonnet' });
  });

  it('stores an OpenCode model override in the OpenCode field', async () => {
    const update = vi.fn();
    const command = interaction({ custom: 'anthropic/claude-sonnet-4' });
    const openCodeProject = { ...project, defaultProvider: 'opencode' as const };

    await handleModel(command, {
      getProjectByChannel: () => openCodeProject,
      settings: { updateProject: update, updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
      defaultOpenCodeModel: '',
    });

    expect(update).toHaveBeenCalledWith('factory-floor', { openCodeModel: 'anthropic/claude-sonnet-4' });
  });

  it('stores a Codex thinking depth from the slash command', async () => {
    const update = vi.fn();
    const command = interaction({ thinking: 'xhigh' });
    const codexProject = { ...project, defaultProvider: 'codex' as const };

    await handleModel(command, {
      getProjectByChannel: () => codexProject,
      settings: { updateProject: update, updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
    });

    expect(update).toHaveBeenCalledWith('factory-floor', { reasoningEfforts: { codex: 'xhigh' } });
  });

  it('rejects model changes inside an existing task thread', async () => {
    const update = vi.fn();
    const command = interaction({ custom: 'custom-model', thread: true });

    await handleModel(command, {
      getProjectByChannel: () => project,
      settings: { updateProject: update, updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('does not pretend Claude supports the Codex thinking-depth setting', async () => {
    const command = interaction({ thinking: 'high' });

    await handleModel(command, {
      getProjectByChannel: () => project,
      settings: { updateProject: vi.fn(), updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/available only for Codex/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('does not pretend OpenCode supports the Codex thinking-depth setting', async () => {
    const command = interaction({ thinking: 'high' });
    const openCodeProject = { ...project, defaultProvider: 'opencode' as const };

    await handleModel(command, {
      getProjectByChannel: () => openCodeProject,
      settings: { updateProject: vi.fn(), updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/OpenCode.*provider-managed reasoning/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('updates the global Codex PM model and thinking depth from agent-chat', async () => {
    const updateGlobal = vi.fn();
    const activate = vi.fn(async () => undefined);
    const command = interaction({ channelName: 'agent-chat', custom: 'gpt-5.6-luna', thinking: 'xhigh' });

    await handleModel(command, {
      getProjectByChannel: () => undefined,
      settings: { updateProject: vi.fn(), updateGlobal, updateGlobalWithActivation: vi.fn(async (input: unknown, activate: () => Promise<void>) => { await activate(); return input as never; }) },
      getDefaultProvider: () => 'codex',
      activateDefaultProvider: activate,
      defaultClaudeModel: '',
      defaultCodexModel: '',
      primaryChannelId: 'agent-1',
      primaryOwnerId: 'user-1',
    });

    expect(updateGlobal).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith('codex');
  });

  it('updates the global OpenCode PM model without writing the Codex field', async () => {
    const updateGlobalWithActivation = vi.fn(async (input: unknown, activate: () => Promise<void>) => {
      await activate();
      return input as never;
    });
    const activate = vi.fn(async () => undefined);
    const command = interaction({ channelName: 'agent-chat', custom: 'openai/gpt-5.4' });

    await handleModel(command, {
      getProjectByChannel: () => undefined,
      settings: { updateProject: vi.fn(), updateGlobal: vi.fn(), updateGlobalWithActivation },
      getDefaultProvider: () => 'opencode',
      activateDefaultProvider: activate,
      defaultClaudeModel: '',
      defaultOpenCodeModel: '',
      primaryChannelId: 'agent-1',
      primaryOwnerId: 'user-1',
    });

    expect(updateGlobalWithActivation).toHaveBeenCalledWith(
      { openCodeModel: 'openai/gpt-5.4' },
      expect.any(Function),
      undefined,
    );
    expect(activate).toHaveBeenCalledWith('opencode');
  });

  it('reports a missing project provider as unavailable instead of a generic rejection', async () => {
    const command = interaction({ model: 'sonnet' });
    const update = vi.fn();
    await handleModel(command, {
      getProjectByChannel: () => project,
      settings: { updateProject: update, updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      defaultClaudeModel: '',
      checkProvider: vi.fn(async () => ({ available: false, reason: 'Claude is unavailable on this host.' })),
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/provider unavailable|unavailable/i) }));
  });

  it('does not expose global model activation errors', async () => {
    const updateGlobal = vi.fn();
    const activate = vi.fn(async () => { throw new Error('activation failed'); });
    const command = interaction({ channelName: 'agent-chat', custom: 'gpt-5.6-luna' });

    await handleModel(command, {
      getProjectByChannel: () => undefined,
      settings: { updateProject: vi.fn(), updateGlobal, updateGlobalWithActivation: vi.fn(async (_input: unknown, activate: () => Promise<void>) => { await activate(); return {}; }) },
      getDefaultProvider: () => 'codex',
      activateDefaultProvider: activate,
      defaultClaudeModel: '',
      defaultCodexModel: '',
      primaryChannelId: 'agent-1',
      primaryOwnerId: 'user-1',
    });

    expect(updateGlobal).not.toHaveBeenCalled();
    const content = String(command.reply.mock.calls[0][0].content);
    expect(content).toMatch(/could not be changed/i);
    expect(content).not.toContain('activation failed');
  });

  it('does not trust a channel named agent-chat without the configured PM identity', async () => {
    const command = interaction({ channelName: 'agent-chat', custom: 'spoofed-model' });
    await handleModel(command, {
      getProjectByChannel: () => undefined,
      settings: { updateProject: vi.fn(), updateGlobal: vi.fn(), updateGlobalWithActivation: vi.fn() },
      getDefaultProvider: () => 'codex',
      defaultClaudeModel: '',
      primaryChannelId: 'real-agent-chat',
      primaryOwnerId: 'user-1',
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/project channel/i) }));
  });
});

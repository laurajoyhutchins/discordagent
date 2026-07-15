import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Project } from '../types.js';
import { handleProvider } from './provider.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
};

function interaction(options: {
  channelId?: string;
  provider?: string | null;
  isThread?: boolean;
}) {
  return {
    channelId: options.channelId ?? 'agent-1',
    channel: { isThread: () => options.isThread ?? false },
    options: { getString: vi.fn(() => options.provider ?? null) },
    reply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

describe('/provider', () => {
  it('reports the current project provider when no option is supplied', async () => {
    const command = interaction({ provider: null });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: vi.fn(),
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('claude'),
      ephemeral: true,
    }));
  });

  it('persists Claude as the project provider', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'claude' });
    await handleProvider(command, {
      getProjectByChannel: () => ({ ...project, defaultProvider: 'codex' }),
      updateProjectProvider: update,
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'claude');
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Claude'),
    }));
  });

  it('refuses Codex until Phase 2 without mutating the project', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'codex' });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: update,
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/Phase 2/i),
      ephemeral: true,
    }));
  });

  it('rejects provider changes from a task thread', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'claude', isThread: true });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: update,
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      ephemeral: true,
    }));
  });

  it('rejects use outside a project channel', async () => {
    const command = interaction({ channelId: 'elsewhere', provider: 'claude' });
    await handleProvider(command, {
      getProjectByChannel: () => undefined,
      updateProjectProvider: vi.fn(),
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/project channel/i),
      ephemeral: true,
    }));
  });
});

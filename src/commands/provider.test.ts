import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
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
  channelName?: string;
}) {
  return {
    channelId: options.channelId ?? 'agent-1',
    channel: { name: options.channelName, isThread: () => options.isThread ?? false },
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
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('claude'),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('persists Claude as the project provider', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'claude' });
    await handleProvider(command, {
      getProjectByChannel: () => ({ ...project, defaultProvider: 'codex' }),
      updateProjectProvider: update,
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'claude');
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Claude'),
    }));
  });

  it('persists Codex when the runtime reports it ready', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'codex' });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: update,
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(update).toHaveBeenCalledWith('factory-floor', 'codex');
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/Codex/i),
    }));
  });

  it('does not mutate the project when Codex authentication is required', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'codex' });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: update,
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: false, authenticationRequired: true, reason: 'Sign in with /codex-auth login' })),
    });
    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/codex-auth login') }));
  });

  it('rejects provider changes from a task thread', async () => {
    const update = vi.fn();
    const command = interaction({ provider: 'claude', isThread: true });
    await handleProvider(command, {
      getProjectByChannel: () => project,
      updateProjectProvider: update,
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(update).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('rejects use outside a project channel', async () => {
    const command = interaction({ channelId: 'elsewhere', provider: 'claude' });
    await handleProvider(command, {
      getProjectByChannel: () => undefined,
      updateProjectProvider: vi.fn(),
      getDefaultProvider: () => undefined,
      updateDefaultProvider: vi.fn(),
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/project channel/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('reports and updates the global provider from the PM channel', async () => {
    const update = vi.fn();
    const command = interaction({ channelId: 'agent-chat', channelName: 'agent-chat', provider: 'codex' });
    await handleProvider(command, {
      getProjectByChannel: () => undefined,
      updateProjectProvider: vi.fn(),
      getDefaultProvider: () => undefined,
      updateDefaultProvider: update,
      checkProvider: vi.fn(async () => ({ available: true })),
    });

    expect(update).toHaveBeenCalledWith('codex');
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/global.*Codex/i) }));
  });
});

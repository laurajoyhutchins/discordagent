import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { Guild } from 'discord.js';
import { createProjectChannels } from './channelManager.js';

function guild() {
  let counter = 0;
  const create = vi.fn(async (input: Record<string, unknown>) => ({
    id: `channel-${++counter}`,
    ...input,
    createWebhook: vi.fn(async () => {
      throw new Error('webhooks must not be created');
    }),
  }));
  return {
    members: { me: { id: 'bot-1' } },
    channels: { create },
  } as unknown as Guild & { channels: { create: ReturnType<typeof vi.fn> } };
}

describe('createProjectChannels', () => {
  it('creates a provider-neutral agent channel', async () => {
    const fakeGuild = guild();
    const result = await createProjectChannels(fakeGuild, 'factory-floor', false);

    expect(fakeGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'agent',
      type: ChannelType.GuildText,
      topic: expect.stringMatching(/agent tasks/i),
    }));
    expect(result).toEqual({ categoryId: 'channel-1', agentChannelId: 'channel-2' });
  });

  it('creates Roborev as a normal bot channel without webhook credentials', async () => {
    const fakeGuild = guild();
    const result = await createProjectChannels(fakeGuild, 'factory-floor', true);

    expect(fakeGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'roborev',
      type: ChannelType.GuildText,
    }));
    expect(result).toEqual({
      categoryId: 'channel-1',
      agentChannelId: 'channel-2',
      roborevChannelId: 'channel-3',
    });
    expect(result).not.toHaveProperty('roborevWebhookId');
    expect(result).not.toHaveProperty('roborevWebhookToken');
  });
});

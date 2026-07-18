import { describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import type { Guild } from 'discord.js';
import { createProjectChannels, ensurePrimaryAgentChannel } from './channelManager.js';

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
    id: 'guild-1',
    members: { me: { id: 'bot-1', permissions: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageChannels,
    ]) } },
    channels: { cache: { find: () => undefined }, fetch: vi.fn(async () => null), create },
  } as unknown as Guild & { channels: { cache: { find: ReturnType<typeof vi.fn> }; fetch: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } };
}

describe('createProjectChannels', () => {
  it('fails closed before creating channels when required bot permissions are missing', async () => {
    const fakeGuild = guild();
    Object.defineProperty(fakeGuild.members.me, 'permissions', {
      value: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ]),
      configurable: true,
    });

    await expect(createProjectChannels(fakeGuild, 'factory-floor', false))
      .rejects.toThrow(/missing required permissions/i);
    expect(fakeGuild.channels.create).not.toHaveBeenCalled();
  });

  it('includes thread sending in authorized project-role overwrites', async () => {
    const fakeGuild = guild();
    await createProjectChannels(fakeGuild, 'factory-floor', false, ['role-1']);
    const category = fakeGuild.channels.create.mock.calls[0][0] as { permissionOverwrites: Array<{ id: string; allow?: string[] }> };
    expect(category.permissionOverwrites.find(item => item.id === 'role-1')?.allow)
      .toEqual(expect.arrayContaining([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads]));
  });

  it('fails closed before creating the primary channel when bot permissions are missing', async () => {
    const fakeGuild = guild();
    Object.defineProperty(fakeGuild.members.me, 'permissions', {
      value: new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]),
      configurable: true,
    });

    await expect(ensurePrimaryAgentChannel(fakeGuild, [])).rejects.toThrow(/missing required permissions/i);
    expect(fakeGuild.channels.create).not.toHaveBeenCalled();
  });

  it('rejects an existing inaccessible primary channel', async () => {
    const fakeGuild = guild();
    const existing = { type: ChannelType.GuildText, name: 'agent-chat' };
    const existingWithAcl = { ...existing, id: 'primary', permissionOverwrites: { set: vi.fn(async () => undefined) }, permissionsFor: vi.fn(() => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) };
    fakeGuild.channels.fetch.mockResolvedValue(existingWithAcl);
    Object.defineProperty(fakeGuild.members.me, 'permissionsIn', {
      value: vi.fn(() => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])),
      configurable: true,
    });

    await expect(ensurePrimaryAgentChannel(fakeGuild, [], undefined, 'primary')).rejects.toThrow(/channel permissions/i);
    expect(fakeGuild.channels.create).not.toHaveBeenCalled();
  });

  it('uses the canonical primary channel ID instead of a colliding channel name and repairs stale ACLs', async () => {
    const fakeGuild = guild();
    const stale = {
      id: 'canonical-primary',
      type: ChannelType.GuildText,
      permissionOverwrites: { set: vi.fn(async () => undefined) },
      permissionsFor: vi.fn(() => new PermissionsBitField([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads,
      ])),
    };
    fakeGuild.channels.cache.find = vi.fn(() => ({ id: 'wrong-by-name', type: ChannelType.GuildText, name: 'agent-chat' }) as never);
    fakeGuild.channels.fetch.mockResolvedValue(stale);
    Object.defineProperty(fakeGuild.members.me, 'permissionsIn', {
      value: vi.fn(() => new PermissionsBitField([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads,
      ])),
      configurable: true,
    });

    await expect(ensurePrimaryAgentChannel(fakeGuild, [], 'owner-1', 'canonical-primary')).resolves.toBe(stale);
    expect(fakeGuild.channels.fetch).toHaveBeenCalledWith('canonical-primary');
    expect(stale.permissionOverwrites.set).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'guild-1' }),
      expect.objectContaining({ id: 'bot-1' }),
      expect.objectContaining({ id: 'owner-1' }),
    ]));
    expect(fakeGuild.channels.create).not.toHaveBeenCalled();
  });

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

  it('derives bot overwrites from the bootstrap profile and preserves private authorized-role access', async () => {
    const fakeGuild = guild();
    await createProjectChannels(fakeGuild, 'factory-floor', false, ['role-1']);

    const category = fakeGuild.channels.create.mock.calls[0][0] as { permissionOverwrites: Array<{ id: string; allow?: string[]; deny?: string[] }> };
    const botOverwrite = category.permissionOverwrites.find(item => item.id === 'bot-1');
    const roleOverwrite = category.permissionOverwrites.find(item => item.id === 'role-1');
    const everyoneOverwrite = category.permissionOverwrites.find(item => item.id === 'guild-1');

    expect(botOverwrite?.allow).toEqual(expect.arrayContaining([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads,
    ]));
    expect(botOverwrite?.allow).not.toContain(PermissionFlagsBits.Administrator);
    expect(roleOverwrite?.allow).toEqual(expect.arrayContaining([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]));
    expect(everyoneOverwrite?.deny).toContain(PermissionFlagsBits.ViewChannel);
  });

  it('cleans only newly created channels when project onboarding fails partway', async () => {
    const fakeGuild = guild();
    const category = { id: 'new-category', delete: vi.fn(async () => undefined) };
    const agent = { id: 'new-agent', delete: vi.fn(async () => undefined) };
    fakeGuild.channels.create
      .mockResolvedValueOnce(category)
      .mockResolvedValueOnce(agent)
      .mockRejectedValueOnce(new Error('roborev create failed'));

    await expect(createProjectChannels(fakeGuild, 'factory-floor', true)).rejects.toThrow(/roborev create failed/);
    expect(agent.delete).toHaveBeenCalledOnce();
    expect(category.delete).toHaveBeenCalledOnce();
  });

  it('surfaces compensation failures while retaining the original onboarding error', async () => {
    const fakeGuild = guild();
    const category = { id: 'new-category', delete: vi.fn(async () => { throw new Error('permission denied'); }) };
    const agent = { id: 'new-agent', delete: vi.fn(async () => undefined) };
    fakeGuild.channels.create
      .mockResolvedValueOnce(category)
      .mockRejectedValueOnce(new Error('agent create failed'));

    await expect(createProjectChannels(fakeGuild, 'factory-floor', false))
      .rejects.toThrow(/agent create failed.*compensation failed.*permission denied/i);
    expect(category.delete).toHaveBeenCalledOnce();
  });
});

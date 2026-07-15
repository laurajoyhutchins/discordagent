import {
  ChannelType,
  Guild,
  OverwriteResolvable,
  PermissionFlagsBits,
} from 'discord.js';

interface ChannelSetup {
  categoryId: string;
  agentChannelId: string;
  roborevChannelId?: string;
}

export async function createProjectChannels(
  guild: Guild,
  projectName: string,
  includeRoborev: boolean = false
): Promise<ChannelSetup> {
  const botMember = guild.members.me!;

  const permissionOverwrites: OverwriteResolvable[] = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    },
  ];

  const category = await guild.channels.create({
    name: projectName,
    type: ChannelType.GuildCategory,
    permissionOverwrites,
  });

  const agentChannel = await guild.channels.create({
    name: 'agent',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Agent tasks for ${projectName}`,
  });

  const result: ChannelSetup = {
    categoryId: category.id,
    agentChannelId: agentChannel.id,
  };

  if (includeRoborev) {
    const roborevChannel = await guild.channels.create({
      name: 'roborev',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Roborev code reviews for ${projectName}`,
    });

    result.roborevChannelId = roborevChannel.id;
  }

  return result;
}

export async function deleteProjectChannels(
  guild: Guild,
  categoryId: string,
  agentChannelId: string,
  roborevChannelId?: string
): Promise<void> {
  const deleteChannel = async (id: string) => {
    try {
      const ch = await guild.channels.fetch(id);
      if (ch) await ch.delete();
    } catch {
      // Channel may already be deleted
    }
  };

  await deleteChannel(agentChannelId);
  if (roborevChannelId) {
    await deleteChannel(roborevChannelId);
  }
  await deleteChannel(categoryId);
}

export async function ensurePrimaryAgentChannel(guild: Guild, authorizedRoleIds: readonly string[]): Promise<import('discord.js').TextChannel> {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === 'agent-chat');
  if (existing?.type === ChannelType.GuildText) return existing;
  const botMember = guild.members.me!;
  const permissionOverwrites: OverwriteResolvable[] = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...authorizedRoleIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ];
  return guild.channels.create({ name: 'agent-chat', type: ChannelType.GuildText, topic: 'Primary project-owner agent', permissionOverwrites });
}

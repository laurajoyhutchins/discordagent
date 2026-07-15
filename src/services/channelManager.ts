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
  roborevWebhookId?: string;
  roborevWebhookToken?: string;
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
        PermissionFlagsBits.ManageWebhooks,
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

  const claudeChannel = await guild.channels.create({
    name: 'claude',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Claude Code prompts for ${projectName}`,
  });

  const result: ChannelSetup = {
    categoryId: category.id,
    agentChannelId: claudeChannel.id,
  };

  if (includeRoborev) {
    const roborevChannel = await guild.channels.create({
      name: 'roborev',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Roborev code reviews for ${projectName}`,
    });

    const webhook = await roborevChannel.createWebhook({
      name: `roborev-${projectName}`,
      reason: `Roborev webhook for project ${projectName}`,
    });

    result.roborevChannelId = roborevChannel.id;
    result.roborevWebhookId = webhook.id;
    result.roborevWebhookToken = webhook.token!;
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

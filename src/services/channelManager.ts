import {
  ChannelType,
  Guild,
  OverwriteResolvable,
  PermissionFlagsBits,
} from 'discord.js';

interface ChannelSetup {
  categoryId: string;
  claudeChannelId: string;
  roborevChannelId: string;
  roborevWebhookId: string;
  roborevWebhookToken: string;
}

export async function createProjectChannels(
  guild: Guild,
  projectName: string
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

  return {
    categoryId: category.id,
    claudeChannelId: claudeChannel.id,
    roborevChannelId: roborevChannel.id,
    roborevWebhookId: webhook.id,
    roborevWebhookToken: webhook.token!,
  };
}

export async function deleteProjectChannels(
  guild: Guild,
  categoryId: string,
  claudeChannelId: string,
  roborevChannelId: string
): Promise<void> {
  const deleteChannel = async (id: string) => {
    try {
      const ch = await guild.channels.fetch(id);
      if (ch) await ch.delete();
    } catch {
      // Channel may already be deleted
    }
  };

  await deleteChannel(claudeChannelId);
  await deleteChannel(roborevChannelId);
  await deleteChannel(categoryId);
}

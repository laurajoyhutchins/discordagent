import { ChatInputCommandInteraction } from 'discord.js';
import { cancelSession, getSession } from '../services/claudeRunner.js';
import { getProjectByChannel } from '../services/projectStore.js';

export async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;

  const project = getProjectByChannel(channelId);
  if (!project) {
    await interaction.reply({ content: 'This command can only be used in a project #claude channel.', ephemeral: true });
    return;
  }

  const session = getSession(project.claudeChannelId);
  if (!session) {
    await interaction.reply({ content: 'No active Claude session in this channel.', ephemeral: true });
    return;
  }

  const cancelled = await cancelSession(project.claudeChannelId);
  if (cancelled) {
    await interaction.reply('Claude session cancelled.');
  } else {
    await interaction.reply({ content: 'Failed to cancel session.', ephemeral: true });
  }
}

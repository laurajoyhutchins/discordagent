import { ChatInputCommandInteraction } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { stopLoop } from '../services/loopRunner.js';
import { isAuthorized } from '../utils/permissions.js';

export async function handleStopLoop(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
  if (!isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized.', ephemeral: true });
    return;
  }

  const project = getProjectByChannel(interaction.channelId);
  if (!project || interaction.channelId !== project.claudeChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project #claude channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const replyMsg = await interaction.fetchReply();
  await stopLoop(project.claudeChannelId, replyMsg);
}

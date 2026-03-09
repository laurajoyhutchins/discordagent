import { ChatInputCommandInteraction } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { stopLoop } from '../services/loopRunner.js';

// Note: Authorization is enforced by interactionHandler.ts before this handler is called.
export async function handleStopLoop(interaction: ChatInputCommandInteraction): Promise<void> {
  const project = getProjectByChannel(interaction.channelId);
  if (!project || interaction.channelId !== project.claudeChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project #claude channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const replyMsg = await interaction.fetchReply();
  await stopLoop(project.claudeChannelId, replyMsg);
}

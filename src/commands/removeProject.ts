import { ChatInputCommandInteraction } from 'discord.js';
import { removeProject } from '../services/projectStore.js';
import { deleteProjectChannels } from '../services/channelManager.js';
import { cancelSession } from '../services/claudeRunner.js';

export async function handleRemoveProject(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true);

  const project = removeProject(name);
  if (!project) {
    await interaction.reply({ content: `Project "${name}" not found.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Kill any active session
  await cancelSession(project.claudeChannelId);

  // Delete channels
  try {
    await deleteProjectChannels(
      interaction.guild!,
      project.categoryId,
      project.claudeChannelId,
      project.roborevChannelId // may be undefined — channelManager handles it
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Project "${name}" removed from config, but channel cleanup failed: ${msg}`);
    return;
  }

  await interaction.editReply(`Project **${name}** removed and channels cleaned up.`);
}

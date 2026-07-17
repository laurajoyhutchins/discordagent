import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { removeProject } from '../services/projectStore.js';
import { deleteProjectChannels } from '../services/channelManager.js';

export async function handleRemoveProject(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true);

  const project = removeProject(name);
  if (!project) {
    await interaction.reply({ content: `Project "${name}" not found.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Delete channels
  try {
    await deleteProjectChannels(
      interaction.guild!,
      project.categoryId,
      project.agentChannelId,
      project.roborevChannelId // may be undefined — channelManager handles it
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Project "${name}" removed from config, but channel cleanup failed: ${msg}`);
    return;
  }

  await interaction.editReply(`Project **${name}** archived and channels cleaned up. Existing task worktrees and history were preserved.`);
}

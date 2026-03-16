import { ChatInputCommandInteraction } from 'discord.js';
import { buildUsageEmbed } from '../services/usageTracker.js';

export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const embed = buildUsageEmbed();
  await interaction.editReply({ embeds: [embed] });
}

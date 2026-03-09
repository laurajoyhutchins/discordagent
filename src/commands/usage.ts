import { ChatInputCommandInteraction } from 'discord.js';
import { buildUsageEmbed } from '../services/usageTracker.js';

export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = buildUsageEmbed();
  await interaction.reply({ embeds: [embed] });
}

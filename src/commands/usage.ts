import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { AGENT_PROVIDER_IDS } from '../agents/contracts.js';
import { providerLabel } from '../agents/providerLabels.js';
import { getUsageAdmissionService } from '../services/usageAdmissionRegistry.js';

export async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const service = getUsageAdmissionService();
  if (!service) {
    const unavailable = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Provider Usage and Reservations')
      .setDescription('Usage admission is not initialized yet.');
    await interaction.editReply({ embeds: [unavailable] });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Provider Usage and Reservations')
    .setTimestamp();

  for (const provider of AGENT_PROVIDER_IDS) {
    const state = service.posture(provider);
    const active = service.reservations(provider);
    const lines = [
      `**Operating state:** ${state.posture}`,
      state.available === undefined ? '**Available:** not reported yet' : `**Available:** ${state.available.toFixed(1)}%`,
      `**Reserved:** ${state.reserved.toFixed(1)}% across ${active.length} task${active.length === 1 ? '' : 's'}`,
    ];
    embed.addFields({ name: providerLabel(provider), value: lines.join('\n'), inline: true });
  }

  const reservations = service.reservations();
  if (reservations.length > 0) {
    embed.addFields({
      name: 'Active reservations',
      value: reservations.slice(0, 10).map(item =>
        `${item.provider} · ${item.taskClass} · ${item.low.toFixed(1)}–${item.high.toFixed(1)}${item.taskId ? ` · task ${item.taskId.slice(0, 8)}` : ''}`
      ).join('\n'),
    });
  }

  embed.setFooter({ text: 'Routine conversations omit this telemetry unless it affects feasibility.' });
  await interaction.editReply({ embeds: [embed] });
}

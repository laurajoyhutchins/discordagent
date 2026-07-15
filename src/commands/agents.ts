import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getTaskRepository } from '../services/agentRuntimeService.js';
import { getUsageAdmissionService } from '../services/usageAdmissionRegistry.js';

export async function handleAgents(interaction: ChatInputCommandInteraction): Promise<void> {
  const tasks = getTaskRepository().listActive();
  const usage = getUsageAdmissionService();
  if (tasks.length === 0) {
    await interaction.reply({ content: 'No agent tasks are currently active.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Active Agent Tasks')
    .setColor(0x5865f2)
    .setTimestamp();

  for (const task of tasks.slice(0, 25)) {
    const reservation = usage?.reservations(task.provider).find(item => item.taskId === task.id);
    const reservationText = reservation
      ? `\n**Reserved capacity:** ${reservation.low.toFixed(1)}–${reservation.high.toFixed(1)} (${reservation.confidence})`
      : '';
    embed.addFields({
      name: `${task.projectName} · ${task.provider} · ${task.status}`,
      value: `**Task:** ${task.objective.slice(0, 300)}\n**Thread:** <#${task.threadId}>${reservationText}`,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

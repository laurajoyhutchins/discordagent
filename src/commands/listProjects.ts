import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getAllProjects } from '../services/projectStore.js';
import { getLoop, formatDuration } from '../services/loopRunner.js';

export async function handleListProjects(interaction: ChatInputCommandInteraction): Promise<void> {
  const projects = getAllProjects();
  if (projects.length === 0) {
    await interaction.reply({ content: 'No projects registered. Use `/add-project` to add one.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder().setTitle('Registered Projects').setColor(0x5865f2);
  for (const project of projects) {
    const loop = getLoop(project.agentChannelId);
    const status = loop
      ? `🔁 Loop every ${formatDuration(loop.intervalMs)} (iteration #${loop.iteration})`
      : '⚪ Ready';
    let value = [
      `**Path:** \`${project.workingDirectory}\``,
      `**Provider:** ${project.defaultProvider}`,
      `**Status:** ${status}`,
      `**Agent:** <#${project.agentChannelId}>`,
    ].join('\n');
    if (project.roborevChannelId) value += `\n**Roborev:** <#${project.roborevChannelId}>`;
    embed.addFields({ name: project.name, value });
  }
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

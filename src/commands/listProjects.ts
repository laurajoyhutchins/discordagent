import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { providerLabel } from '../agents/providerLabels.js';
import { formatEmptyState, operatorEmbed } from '../discord/presentation.js';
import { getAllProjects } from '../services/projectStore.js';
import { getLoop, formatDuration } from '../services/loopRunner.js';

export async function handleListProjects(interaction: ChatInputCommandInteraction): Promise<void> {
  const projects = getAllProjects();
  if (projects.length === 0) {
    await interaction.reply({
      content: formatEmptyState({
        title: 'No projects yet',
        description: 'Discord Agent is ready, but it does not have a registered workspace to operate in.',
        action: 'Run `/add-project` with a name and the repository path on the bot host.',
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = operatorEmbed({
    title: 'Projects',
    description: `${projects.length} registered ${projects.length === 1 ? 'workspace' : 'workspaces'}. Open a project channel and describe an outcome to create a durable task.`,
    footer: 'Project defaults apply to new tasks; existing task providers and sessions remain unchanged.',
  });
  for (const project of projects) {
    const loop = getLoop(project.agentChannelId);
    const status = loop
      ? `Looping every ${formatDuration(loop.intervalMs)} · iteration ${loop.iteration}`
      : 'Ready for work';
    let value = [
      `**Channel:** <#${project.agentChannelId}>`,
      `**Provider:** ${providerLabel(project.defaultProvider)}`,
      `**Status:** ${status}`,
      `**Path:** \`${project.workingDirectory}\``,
    ].join('\n');
    if (project.roborevChannelId) value += `\n**Reviews:** <#${project.roborevChannelId}>`;
    embed.addFields({ name: project.name, value });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

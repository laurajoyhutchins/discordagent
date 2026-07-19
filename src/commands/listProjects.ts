import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { providerLabel } from '../agents/providerLabels.js';
import {
  formatEmptyState,
  operatorEmbed,
  operatorReplyPayload,
} from '../discord/presentation.js';
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

  const summary = `${projects.length} registered ${projects.length === 1 ? 'workspace' : 'workspaces'}. Open a project channel and describe an outcome to create a durable task.`;
  const entries = projects.map(project => {
    const loop = getLoop(project.agentChannelId);
    const status = loop
      ? `Looping every ${formatDuration(loop.intervalMs)} · iteration ${loop.iteration}`
      : 'Ready for work';
    const lines = [
      `**Channel:** <#${project.agentChannelId}>`,
      `**Provider:** ${providerLabel(project.defaultProvider)}`,
      `**Status:** ${status}`,
      `**Path:** \`${project.workingDirectory}\``,
      ...(project.roborevChannelId ? [`**Reviews:** <#${project.roborevChannelId}>`] : []),
    ];
    return { name: project.name, lines };
  });

  const embed = operatorEmbed({
    title: 'Projects',
    description: summary,
    footer: 'Project defaults apply to new tasks; existing task providers and sessions remain unchanged.',
  }).addFields(entries.map(entry => ({ name: entry.name, value: entry.lines.join('\n') })));
  const fallback = [
    '**Projects**',
    summary,
    '',
    ...entries.flatMap(entry => [`**${entry.name}**`, ...entry.lines, '']),
  ].join('\n').trim();
  const payload = await operatorReplyPayload(interaction, { embed, fallback });

  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

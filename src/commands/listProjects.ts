import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getAllProjects } from '../services/projectStore.js';
import { getSessionsByChannel } from '../services/claudeRunner.js';
import { getLoop, formatDuration } from '../services/loopRunner.js';

export async function handleListProjects(interaction: ChatInputCommandInteraction): Promise<void> {
  const projects = getAllProjects();

  if (projects.length === 0) {
    await interaction.reply({ content: 'No projects registered. Use `/add-project` to add one.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Registered Projects')
    .setColor(0x5865f2);

  for (const p of projects) {
    const sessions = getSessionsByChannel(p.claudeChannelId);
    const activeSessions = sessions.filter(s => s.busy);
    const loop = getLoop(p.claudeChannelId);

    let status = '⚪ Idle';
    if (activeSessions.length > 0) {
      status = `🟢 ${activeSessions.length} active session${activeSessions.length > 1 ? 's' : ''}`;
    }
    if (loop) {
      status += ` | 🔁 Loop (every ${formatDuration(loop.intervalMs)}, #${loop.iteration})`;
    }

    let value = `**Path:** \`${p.workingDirectory}\`\n**Status:** ${status}\n**Claude:** <#${p.claudeChannelId}>`;
    if (p.roborevChannelId) {
      value += ` | **Roborev:** <#${p.roborevChannelId}>`;
    }
    embed.addFields({ name: p.name, value });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

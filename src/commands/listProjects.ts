import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getAllProjects } from '../services/projectStore.js';
import { hasSession } from '../services/claudeRunner.js';

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
    const status = hasSession(p.claudeChannelId) ? '🟢 Active session' : '⚪ Idle';
    embed.addFields({
      name: p.name,
      value: `**Path:** \`${p.workingDirectory}\`\n**Status:** ${status}\n**Claude:** <#${p.claudeChannelId}> | **Roborev:** <#${p.roborevChannelId}>`,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

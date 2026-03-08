import { ChatInputCommandInteraction } from 'discord.js';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addProject, getProject } from '../services/projectStore.js';
import { createProjectChannels } from '../services/channelManager.js';

export async function handleAddProject(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = interaction.options.getString('path', true);

  // Validate path exists and is a directory
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    await interaction.reply({ content: `Path \`${path}\` does not exist or is not a directory.`, ephemeral: true });
    return;
  }

  // Check if it's a git repo
  if (!existsSync(join(path, '.git'))) {
    await interaction.reply({ content: `Path \`${path}\` is not a git repository (no .git directory).`, ephemeral: true });
    return;
  }

  // Check for duplicate
  if (getProject(name)) {
    await interaction.reply({ content: `Project "${name}" already exists. Remove it first.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild!;
    const channels = await createProjectChannels(guild, name);

    addProject({
      name,
      workingDirectory: path,
      ...channels,
    });

    const webhookUrl = `https://discord.com/api/webhooks/${channels.roborevWebhookId}/${channels.roborevWebhookToken}`;

    await interaction.editReply(
      `Project **${name}** created!\n` +
      `- <#${channels.claudeChannelId}> — send Claude prompts here\n` +
      `- <#${channels.roborevChannelId}> — code reviews appear here\n\n` +
      `**Roborev webhook URL:**\n\`\`\`\n${webhookUrl}\n\`\`\`\n` +
      `Add this to your roborev config to route reviews to Discord.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to create project: ${msg}`);
  }
}

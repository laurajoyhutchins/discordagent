import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { AgentProviderId } from '../agents/contracts.js';
import { providerLabel } from '../agents/providerLabels.js';
import { operatorEmbed } from '../discord/presentation.js';
import { addProject, getDefaultProvider, getProject } from '../services/projectStore.js';
import { createProjectChannels, deleteProjectChannels } from '../services/channelManager.js';
import { config } from '../config.js';
import { getProviderRegistry } from '../services/agentRuntimeService.js';
import {
  isRoborevCliAvailable,
  hasRoborevSetup,
  notifyRoborevConfigurationChanged,
} from '../integrations/roborev/index.js';

export function isPathWithinBase(base: string, candidate: string, pathApi = { relative, isAbsolute, sep }): boolean {
  const relativePath = pathApi.relative(base, candidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relativePath);
}

export async function handleAddProject(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = interaction.options.getString('path', true);
  const roborevOption = interaction.options.getBoolean('roborev'); // null if not provided
  const defaultProvider: AgentProviderId | undefined = getDefaultProvider();

  if (!defaultProvider || getProviderRegistry().list().length === 0) {
    await interaction.reply({
      content: 'Choose a provider in **#agent-chat** first. The selected global provider will be inherited by this project.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (getProviderRegistry().list().includes(defaultProvider)) {
    const availability = await getProviderRegistry().availability(defaultProvider);
    if (!availability.available) {
      await interaction.reply({
        content: `The stored global provider **${defaultProvider}** is unavailable. Choose an available provider in **#agent-chat** before adding a project.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  } else {
    await interaction.reply({
      content: `The stored global provider **${defaultProvider}** is not available on this host. Choose an available provider in **#agent-chat** before adding a project.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Validate path exists and is a directory
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    await interaction.reply({ content: `Path \`${path}\` does not exist or is not a directory.`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Resolve symlinks and validate against allowed base directory
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(path);
  } catch {
    await interaction.reply({ content: 'The provided path could not be resolved (broken symlink or inaccessible).', flags: MessageFlags.Ephemeral });
    return;
  }
  if (config.projectsBaseDir) {
    let resolvedBase: string;
    try {
      resolvedBase = realpathSync(config.projectsBaseDir);
    } catch {
      await interaction.reply({ content: 'Server misconfiguration: PROJECTS_BASE_DIR could not be resolved.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isPathWithinBase(resolvedBase, resolvedPath)) {
      await interaction.reply({
        content: `Path must be within the allowed base directory: \`${config.projectsBaseDir}\``,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }

  // Check if it's a git repo (unless non-git is allowed)
  const isGitRepo = existsSync(join(resolvedPath, '.git'));
  if (!isGitRepo && !config.allowNonGit) {
    await interaction.reply({
      content: `Path is not a git repository (no .git directory).\n\nTo allow non-git directories, set \`ALLOW_NON_GIT=true\` in your \`.env\` file. See the README for details on the risks.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Check for duplicate
  if (getProject(name)) {
    await interaction.reply({ content: `Project "${name}" already exists. Remove it first.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Determine whether to set up roborev:
  // - Explicit roborev:true → enable
  // - Explicit roborev:false → skip
  // - Not provided → auto-detect (roborev CLI available AND project has roborev config)
  let includeRoborev: boolean;
  if (roborevOption !== null) {
    includeRoborev = roborevOption;
  } else {
    includeRoborev = isGitRepo && await isRoborevCliAvailable(config.roborevCliPath) && hasRoborevSetup(resolvedPath);
  }

  let channels: Awaited<ReturnType<typeof createProjectChannels>> | undefined;
  try {
    const guild = interaction.guild!;
    channels = await createProjectChannels(guild, name, includeRoborev, config.authorizedRoleIds);

    addProject({
      name,
      workingDirectory: resolvedPath,
      defaultProvider,
      ...channels,
    });
    if (channels.roborevChannelId) notifyRoborevConfigurationChanged();

    const embed = operatorEmbed({
      title: 'Project ready',
      description: `**${name}** is registered. Open the project channel and describe an outcome to create an isolated durable task.`,
      tone: isGitRepo ? 'success' : 'attention',
      footer: 'New tasks inherit the project provider and settings; existing tasks remain immutable.',
    }).addFields(
      { name: 'Project channel', value: `<#${channels.agentChannelId}>`, inline: true },
      { name: 'Provider', value: providerLabel(defaultProvider), inline: true },
      {
        name: 'Reviews',
        value: channels.roborevChannelId
          ? `<#${channels.roborevChannelId}>`
          : `Not enabled · use \`/roborev project:${name} enable:true\` later`,
      },
    );

    if (!isGitRepo) {
      embed.addFields({
        name: 'Before tasks can start',
        value: 'Initialize the directory as a Git repository and create an initial commit on the bot host.',
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    if (channels && !getProject(name)) {
      try {
        await deleteProjectChannels(interaction.guild!, channels.categoryId, channels.agentChannelId, channels.roborevChannelId, { strict: true });
      } catch (compensationError) {
        const original = err instanceof Error ? err.message : String(err);
        const compensation = compensationError instanceof Error ? compensationError.message : String(compensationError);
        await interaction.editReply(`Failed to create project: ${original}. Compensation also failed: ${compensation}`);
        return;
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to create project: ${msg}`);
  }
}

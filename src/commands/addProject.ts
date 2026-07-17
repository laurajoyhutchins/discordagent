import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AgentProviderId } from '../agents/contracts.js';
import { addProject, getDefaultProvider, getProject } from '../services/projectStore.js';
import { createProjectChannels } from '../services/channelManager.js';
import { config } from '../config.js';

/**
 * Check if roborev is installed and available on this machine
 */
function isRoborevAvailable(): boolean {
  try {
    execFileSync(config.roborevCliPath, ['version'], {
      timeout: 5000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a project directory has roborev set up (has a .roborev config or git hook)
 */
function hasRoborevSetup(projectPath: string): boolean {
  return (
    existsSync(join(projectPath, '.roborev')) ||
    existsSync(join(projectPath, '.roborev.json')) ||
    existsSync(join(projectPath, '.git', 'hooks', 'post-commit'))
  );
}

export async function handleAddProject(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = interaction.options.getString('path', true);
  const roborevOption = interaction.options.getBoolean('roborev'); // null if not provided
  const defaultProvider: AgentProviderId | undefined = getDefaultProvider();

  if (!defaultProvider) {
    await interaction.reply({
      content: 'Choose a provider in **#agent-chat** first. The selected global provider will be inherited by this project.',
      flags: MessageFlags.Ephemeral,
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
    if (!resolvedPath.startsWith(resolvedBase + '/') && resolvedPath !== resolvedBase) {
      await interaction.reply({
        content: `Path must be within the allowed base directory: \`${config.projectsBaseDir}\``,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  // Check if it's a git repo (unless non-git is allowed)
  const isGitRepo = existsSync(join(resolvedPath, '.git'));
  if (!isGitRepo && !config.allowNonGit) {
    await interaction.reply({
      content: `Path is not a git repository (no .git directory).\n\nTo allow non-git directories, set \`ALLOW_NON_GIT=true\` in your \`.env\` file. See the README for details on the risks.`,
      flags: MessageFlags.Ephemeral,
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
    includeRoborev = isGitRepo && isRoborevAvailable() && hasRoborevSetup(resolvedPath);
  }

  try {
    const guild = interaction.guild!;
    const channels = await createProjectChannels(guild, name, includeRoborev);

    addProject({
      name,
      workingDirectory: resolvedPath,
      defaultProvider,
      ...channels,
    });

    let replyMsg = `Project **${name}** created!\n` +
      `- <#${channels.agentChannelId}> — talk to the project agent here`;

    if (!isGitRepo) {
      replyMsg += `\n\n⚠️ **Warning:** This non-Git project was registered, but agent tasks cannot start until the directory is initialized as a Git repository. Run \`git init && git add -A && git commit -m \"initial\"\` before sending a task.`;
    }

    if (channels.roborevChannelId) {
      replyMsg += `\n- <#${channels.roborevChannelId}> — code reviews appear here`;
    } else {
      replyMsg += `\n\n💡 Roborev not enabled. To add it later, remove this project and re-add with \`/add-project name:${name} path:${resolvedPath} roborev:true\``;
    }

    await interaction.editReply(replyMsg);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to create project: ${msg}`);
  }
}

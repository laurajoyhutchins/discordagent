import { ChatInputCommandInteraction } from 'discord.js';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { addProject, getProject } from '../services/projectStore.js';
import { createProjectChannels } from '../services/channelManager.js';
import { config } from '../config.js';

/**
 * Check if roborev is installed and available on this machine
 */
function isRoborevAvailable(): boolean {
  try {
    execFileSync(config.roborevCliPath, ['--version'], {
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

  // Validate path exists and is a directory
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    await interaction.reply({ content: `Path \`${path}\` does not exist or is not a directory.`, ephemeral: true });
    return;
  }

  // Resolve symlinks and validate against allowed base directory
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(path);
  } catch {
    await interaction.reply({ content: 'The provided path could not be resolved (broken symlink or inaccessible).', ephemeral: true });
    return;
  }
  if (config.projectsBaseDir) {
    let resolvedBase: string;
    try {
      resolvedBase = realpathSync(config.projectsBaseDir);
    } catch {
      await interaction.reply({ content: 'Server misconfiguration: PROJECTS_BASE_DIR could not be resolved.', ephemeral: true });
      return;
    }
    if (!resolvedPath.startsWith(resolvedBase + '/') && resolvedPath !== resolvedBase) {
      await interaction.reply({
        content: `Path must be within the allowed base directory: \`${config.projectsBaseDir}\``,
        ephemeral: true,
      });
      return;
    }
  }

  // Check if it's a git repo (unless non-git is allowed)
  const isGitRepo = existsSync(join(resolvedPath, '.git'));
  if (!isGitRepo && !config.allowNonGit) {
    await interaction.reply({
      content: `Path is not a git repository (no .git directory).\n\nTo allow non-git directories, set \`ALLOW_NON_GIT=true\` in your \`.env\` file. See the README for details on the risks.`,
      ephemeral: true,
    });
    return;
  }

  // Check for duplicate
  if (getProject(name)) {
    await interaction.reply({ content: `Project "${name}" already exists. Remove it first.`, ephemeral: true });
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
      ...channels,
    });

    let replyMsg = `Project **${name}** created!\n` +
      `- <#${channels.claudeChannelId}> — send Claude prompts here`;

    if (!isGitRepo) {
      replyMsg += `\n\n⚠️ **Warning:** This is not a git repository. Claude Code will work, but you won't have version control protection against destructive changes. Consider initializing git: \`git init\``;
    }

    if (channels.roborevChannelId) {
      replyMsg += `\n- <#${channels.roborevChannelId}> — code reviews appear here`;
    } else {
      replyMsg += `\n\n💡 Roborev not enabled. To add it later, remove this project and re-add with \`/add-project name:${name} path:${resolvedPath} roborev:true\``;
    }

    await interaction.editReply(replyMsg);

    // Send webhook URL privately via DM (only if roborev was set up)
    if (channels.roborevWebhookId && channels.roborevWebhookToken) {
      const webhookUrl = `https://discord.com/api/webhooks/${channels.roborevWebhookId}/${channels.roborevWebhookToken}`;
      try {
        const dm = await interaction.user.createDM();
        await dm.send(
          `**Roborev webhook URL for ${name}:**\n\`\`\`\n${webhookUrl}\n\`\`\`\n` +
          `Add this to your roborev config to route reviews to Discord.`
        );
        await interaction.followUp({ content: 'Webhook URL sent to your DMs.', ephemeral: true });
      } catch {
        // If DMs are disabled, fall back to ephemeral follow-up
        try {
          await interaction.followUp({
            content: `**Roborev webhook URL:**\n\`\`\`\n${webhookUrl}\n\`\`\`\nAdd this to your roborev config to route reviews to Discord.`,
            ephemeral: true,
          });
        } catch (followUpErr) {
          console.error(`[addProject] Failed to send webhook URL to user ${interaction.user.id}:`, followUpErr);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to create project: ${msg}`);
  }
}

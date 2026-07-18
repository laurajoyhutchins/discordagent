import { ChatInputCommandInteraction, MessageFlags, ChannelType, type Guild, type GuildTextBasedChannel } from 'discord.js';
import { getProject, getProjectRepository } from '../services/projectStore.js';
import { config } from '../config.js';
import {
  isRoborevCliAvailable,
  hasRoborevSetup,
  notifyRoborevConfigurationChanged,
} from '../integrations/roborev/index.js';
import type { Project } from '../types.js';

export interface RoborevCommandDependencies {
  getProject: (name: string) => Project | undefined;
  updateRoborevChannel: (name: string, channelId: string | undefined) => Project;
  checkCliAvailable: () => Promise<boolean>;
  checkHasSetup: (path: string) => boolean;
  createRoborevChannel: (guild: Guild, categoryId: string, projectName: string) => Promise<string>;
  deleteChannel: (guild: Guild, channelId: string) => Promise<void>;
}

export function defaultDependencies(): RoborevCommandDependencies {
  return {
    getProject: (name: string) => getProject(name),
    updateRoborevChannel: (name: string, channelId: string | undefined) =>
      getProjectRepository().updateRoborevChannel(name, channelId),
    checkCliAvailable: () => isRoborevCliAvailable(config.roborevCliPath),
    checkHasSetup: (path: string) => hasRoborevSetup(path),
    createRoborevChannel: async (guild: Guild, categoryId: string, projectName: string) => {
      const channel = await guild.channels.create({
        name: 'roborev',
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Roborev code reviews for ${projectName}`,
      });
      return channel.id;
    },
    deleteChannel: async (guild: Guild, channelId: string) => {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.delete();
    },
  };
}

export async function handleRoborev(
  interaction: ChatInputCommandInteraction,
  injected?: RoborevCommandDependencies,
): Promise<void> {
  const deps = injected ?? defaultDependencies();
  const projectName = interaction.options.getString('project', true);
  const enable = interaction.options.getBoolean('enable', true);

  const project = deps.getProject(projectName);
  if (!project) {
    await interaction.reply({
      content: `Project "${projectName}" not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (enable) {
    if (project.roborevChannelId) {
      await interaction.reply({
        content: `RoboRev is already enabled for **${projectName}** (<#${project.roborevChannelId}>).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await deps.checkCliAvailable())) {
      await interaction.reply({
        content: `RoboRev CLI is not available at \`${config.roborevCliPath}\`. Install RoboRev or set \`ROBOREV_CLI_PATH\` and try again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!deps.checkHasSetup(project.workingDirectory)) {
      await interaction.reply({
        content: `The project directory does not have RoboRev configuration. Add a \`.roborev\` or \`.roborev.json\` file, or a \`.git/hooks/post-commit\` hook, and try again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const roborevChannelId = await deps.createRoborevChannel(interaction.guild!, project.categoryId, projectName);
      deps.updateRoborevChannel(projectName, roborevChannelId);
      notifyRoborevConfigurationChanged();
      await interaction.editReply(`RoboRev enabled for **${projectName}**. Reviews will appear in <#${roborevChannelId}>.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply(`Failed to enable RoboRev: ${msg}`);
    }
  } else {
    if (!project.roborevChannelId) {
      await interaction.reply({
        content: `RoboRev is not enabled for **${projectName}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      await deps.deleteChannel(interaction.guild!, project.roborevChannelId);
      deps.updateRoborevChannel(projectName, undefined);
      notifyRoborevConfigurationChanged();
      await interaction.editReply(`RoboRev disabled for **${projectName}**. The review channel has been removed.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply(`Failed to disable RoboRev: ${msg}`);
    }
  }
}

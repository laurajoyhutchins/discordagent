import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { notifyRoborevConfigurationChanged } from '../integrations/roborev/index.js';
import { deleteProjectChannels } from '../services/channelManager.js';
import { terminalizeLoopsByProject } from '../services/loopRunner.js';
import { getProject, removeProject } from '../services/projectStore.js';
import type { Project } from '../types.js';

export interface RemoveProjectDependencies {
  readonly getProject: (name: string) => Project | undefined;
  readonly terminalizeLoopsByProject: (projectName: string, reason: string) => readonly unknown[];
  readonly removeProject: (name: string) => Project | undefined;
  readonly deleteProjectChannels: (
    guild: Guild,
    categoryId: string,
    agentChannelId: string,
    roborevChannelId?: string,
  ) => Promise<void>;
  readonly notifyRoborevConfigurationChanged: () => void;
}

const DEFAULT_DEPENDENCIES: RemoveProjectDependencies = {
  getProject,
  terminalizeLoopsByProject,
  removeProject,
  deleteProjectChannels,
  notifyRoborevConfigurationChanged,
};

export async function handleRemoveProject(
  interaction: ChatInputCommandInteraction,
  dependencies: RemoveProjectDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const existing = dependencies.getProject(name);
  if (!existing) {
    await interaction.reply({ content: `Project "${name}" not found.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  const terminalizedLoops = dependencies.terminalizeLoopsByProject(name, 'Project archived');
  const project = dependencies.removeProject(name);
  if (!project) {
    await interaction.editReply(
      `Project "${name}" changed before it could be archived. No channels were deleted.`,
    );
    return;
  }
  if (project.roborevChannelId) dependencies.notifyRoborevConfigurationChanged();

  try {
    await dependencies.deleteProjectChannels(
      interaction.guild!,
      project.categoryId,
      project.agentChannelId,
      project.roborevChannelId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(
      `Project "${name}" was archived and ${terminalizedLoops.length} scheduled loop(s) stopped, `
      + `but channel cleanup failed: ${message}`,
    );
    return;
  }

  await interaction.editReply(
    `Project **${name}** archived, ${terminalizedLoops.length} scheduled loop(s) stopped, `
    + 'and channels cleaned up. Existing task worktrees and history were preserved.',
  );
}

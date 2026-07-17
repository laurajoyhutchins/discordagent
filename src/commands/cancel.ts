import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { cancelLoop, getLoopChannelForThread } from '../services/loopRunner.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';

export interface CancelCommandDependencies {
  coordinator: Pick<TaskCoordinator, 'cancelByThread'>;
  getProjectByChannel(channelId: string): Project | undefined;
  cancelLoop(channelId: string): number | null;
  getLoopChannelForThread(threadId: string): string | undefined;
}

function defaultDependencies(): CancelCommandDependencies {
  return {
    coordinator: getTaskCoordinator(),
    getProjectByChannel,
    cancelLoop,
    getLoopChannelForThread,
  };
}

export async function handleCancel(
  interaction: ChatInputCommandInteraction,
  injected?: CancelCommandDependencies,
): Promise<void> {
  const dependencies = injected ?? defaultDependencies();
  const channel = interaction.channel;
  const channelId = interaction.channelId;

  if (channel?.isThread()) {
    const parts: string[] = [];
    if (await dependencies.coordinator.cancelByThread(channelId)) {
      parts.push('Task cancelled in this thread.');
    }

    const loopChannelId = dependencies.getLoopChannelForThread(channelId);
    if (loopChannelId) {
      const iterations = dependencies.cancelLoop(loopChannelId);
      if (iterations !== null) {
        parts.push(`Stopped loop (${iterations} iteration${iterations === 1 ? '' : 's'} completed).`);
      }
    }

    if (parts.length === 0) {
      await interaction.reply({
        content: 'No active task or loop in this thread.',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply(parts.join('\n'));
    }
    return;
  }

  const project = dependencies.getProjectByChannel(channelId);
  if (!project || channelId !== project.agentChannelId) {
    await interaction.reply({
      content: 'This command can only be used in a project channel or task thread.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const iterations = dependencies.cancelLoop(project.agentChannelId);
  const parts = iterations === null
    ? ['No project loop is running.']
    : [`Stopped loop (${iterations} iteration${iterations === 1 ? '' : 's'} completed).`];
  parts.push('To cancel an active agent task, use `/cancel` inside that task thread.');
  await interaction.reply(parts.join('\n'));
}

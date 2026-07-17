import type { GuildMember, MessageContextMenuCommandInteraction } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactSensitiveText } from '../utils/redaction.js';

export interface TurnIntoTaskDependencies {
  coordinator: Pick<TaskCoordinator, 'startFromMessage'>;
  getProjectByChannel(channelId: string): Project | undefined;
  isAuthorized(member: GuildMember | null | undefined): boolean;
}

function defaultDependencies(): TurnIntoTaskDependencies {
  return {
    coordinator: getTaskCoordinator(),
    getProjectByChannel,
    isAuthorized,
  };
}

export async function handleTurnIntoTask(
  interaction: MessageContextMenuCommandInteraction,
  injected?: TurnIntoTaskDependencies,
): Promise<void> {
  const dependencies = injected ?? defaultDependencies();
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
  if (!dependencies.isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized to use this bot.', ephemeral: true });
    return;
  }

  const message = interaction.targetMessage;
  const project = dependencies.getProjectByChannel(message.channelId);
  if (!project || message.channelId !== project.agentChannelId) {
    await interaction.reply({
      content: 'Use **Turn into task** on a message in a registered project `#agent` channel.',
      ephemeral: true,
    });
    return;
  }

  const prompt = message.content.trim();
  if (!prompt) {
    await interaction.reply({
      content: 'The selected message needs text content before it can become a task.',
      ephemeral: true,
    });
    return;
  }

  if (message.hasThread) {
    const existingThread = message.thread;
    await interaction.reply({
      content: existingThread
        ? `This message already has a thread: <#${existingThread.id}>`
        : 'This message already has a thread. Open it to continue the existing work.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const model = project.models?.[project.defaultProvider];
    const task = await dependencies.coordinator.startFromMessage({
      projectName: project.name,
      prompt,
      message,
      provider: project.defaultProvider,
      ...(model ? { model } : {}),
    });
    await interaction.editReply(`Task created: <#${task.threadId}>`);
  } catch (error) {
    const detail = redactSensitiveText(error instanceof Error ? error.message : String(error));
    await interaction.editReply(`Unable to create this task: ${detail}`);
  }
}

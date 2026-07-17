import type { ButtonInteraction, GuildMember } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import { getTaskRepository } from '../services/agentRuntimeService.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';
import type { TaskRecord } from '../types.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactErrorMessage } from '../utils/redaction.js';
import {
  DiscordTaskControlSurface,
  parseTaskControlCustomId,
  type TaskControlSurface,
} from './taskControl.js';

export interface TaskControlButtonDependencies {
  tasks: Pick<TaskRepository, 'findById' | 'getResult'>;
  coordinator: Pick<TaskCoordinator, 'cancelByThread'>;
  controlSurface: TaskControlSurface;
  isAuthorized(member: GuildMember | null | undefined): boolean;
}

const TERMINAL_STATUSES = new Set<TaskRecord['status']>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function defaultDependencies(): TaskControlButtonDependencies {
  return {
    tasks: getTaskRepository(),
    coordinator: getTaskCoordinator(),
    controlSurface: new DiscordTaskControlSurface(),
    isAuthorized,
  };
}

export async function handleTaskControlButton(
  interaction: ButtonInteraction,
  injected?: TaskControlButtonDependencies,
): Promise<boolean> {
  const parsed = parseTaskControlCustomId(interaction.customId);
  if (!parsed) return false;

  const dependencies = injected ?? defaultDependencies();
  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
    if (!dependencies.isAuthorized(member)) {
      await interaction.reply({ content: 'You are not authorized.', ephemeral: true });
      return true;
    }

    const task = dependencies.tasks.findById(parsed.taskId);
    if (!task) {
      await interaction.reply({ content: 'This task no longer exists.', ephemeral: true });
      return true;
    }

    const channel = interaction.channel;
    if (!channel?.isThread() || channel.id !== task.threadId) {
      await interaction.reply({
        content: 'This control can only be used in its original task thread.',
        ephemeral: true,
      });
      return true;
    }

    if (parsed.action === 'inspect') {
      await interaction.reply({
        content: formatTaskInspection(task, dependencies.tasks.getResult(task.id)),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      await interaction.reply({
        content: `This task is already ${task.status}.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    const cancelled = await dependencies.coordinator.cancelByThread(task.threadId);
    const current = dependencies.tasks.findById(task.id);
    if (current) {
      await dependencies.controlSurface.update(
        channel,
        current,
        dependencies.tasks.getResult(task.id),
      ).catch(error => {
        console.warn('[taskControl] Failed to refresh task controls:', redactErrorMessage(error));
      });
    }
    await interaction.editReply(cancelled ? 'Task cancelled.' : 'The task was already terminal.');
    return true;
  } catch (error) {
    console.error('[taskControl] Failed to handle task control:', redactErrorMessage(error));
    const content = 'The task control could not be completed. Check server logs for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => undefined);
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
    }
    return true;
  }
}

export function formatTaskInspection(
  task: TaskRecord,
  result?: ReturnType<TaskRepository['getResult']>,
): string {
  const lines = [
    `**${task.objective}**`,
    `Project: ${task.projectName}`,
    `Provider: ${task.provider}`,
    `State: ${task.status}`,
  ];
  if (result?.branchName) lines.push(`Branch: ${result.branchName}`);
  if (result?.summary) lines.push(`Result: ${result.summary}`);
  if (result?.verification?.length) {
    lines.push(`Verification:\n${result.verification.map(item => `• ${item}`).join('\n')}`);
  }
  if (result?.unresolved?.length) {
    lines.push(`Unresolved:\n${result.unresolved.map(item => `• ${item}`).join('\n')}`);
  }
  return truncate(lines.join('\n'), 2_000);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1)}…`;
}

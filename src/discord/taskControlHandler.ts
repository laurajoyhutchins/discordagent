import {
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import type { TaskResult } from '../agents/contracts.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import { getTaskRepository } from '../services/agentRuntimeService.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';
import type { TaskRecord, WorktreeRecord } from '../types.js';
import { isAuthorized } from '../utils/permissions.js';
import {
  redactErrorMessage,
  redactSensitiveText,
} from '../utils/redaction.js';
import { parseTaskControlCustomId } from './taskControlCard.js';

export interface TaskControlButtonDependencies {
  tasks: Pick<TaskRepository, 'findByThreadId' | 'getResult' | 'getWorktree'>;
  coordinator: Pick<TaskCoordinator, 'cancelByThread'>;
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
    isAuthorized,
  };
}

export async function handleTaskControlButton(
  interaction: ButtonInteraction,
  injected?: TaskControlButtonDependencies,
): Promise<boolean> {
  const action = parseTaskControlCustomId(interaction.customId);
  if (!action) return false;

  const dependencies = injected ?? defaultDependencies();
  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
    if (!dependencies.isAuthorized(member)) {
      await interaction.reply({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: 'This task control is stale or outside its task thread.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const task = dependencies.tasks.findByThreadId(interaction.channelId);
    if (!task) {
      await interaction.reply({
        content: 'This task control is stale or outside its task thread.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (action === 'inspect') {
      await interaction.reply({
        content: formatTaskInspection(
          task,
          dependencies.tasks.getResult(task.id),
          dependencies.tasks.getWorktree(task.id),
        ),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      await interaction.reply({
        content: `This task is already ${task.status}.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cancelled = await dependencies.coordinator.cancelByThread(interaction.channelId);
    await interaction.editReply(cancelled ? 'Task cancelled.' : 'The task was already terminal.');
    return true;
  } catch (error) {
    console.error('[taskControl] Failed to handle task control:', redactErrorMessage(error));
    const content = 'The task control could not be completed. Check server logs for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => undefined);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return true;
  }
}

export function formatTaskInspection(
  task: TaskRecord,
  result?: TaskResult,
  worktree?: WorktreeRecord,
): string {
  const lines = [
    `**${redactSensitiveText(task.objective)}**`,
    `Project: ${redactSensitiveText(task.projectName)}`,
    `Provider: ${task.provider}`,
    ...(task.settings?.model ? [`Model: ${redactSensitiveText(task.settings.model)}`] : []),
    `State: ${task.status}`,
    ...(worktree?.branchName ? [`Branch: ${redactSensitiveText(worktree.branchName)}`] : []),
    ...(result?.summary ? [`Result: ${redactSensitiveText(result.summary)}`] : []),
    ...(result?.verification?.length
      ? [`Verification:\n${result.verification.map(item => `• ${redactSensitiveText(item)}`).join('\n')}`]
      : []),
    ...(result?.unresolved?.length
      ? [`Unresolved:\n${result.unresolved.map(item => `• ${redactSensitiveText(item)}`).join('\n')}`]
      : []),
  ];
  return truncate(lines.join('\n'), 2_000);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1)}…`;
}
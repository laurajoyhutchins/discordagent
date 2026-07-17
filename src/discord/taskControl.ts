import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type AnyThreadChannel,
  type Message,
} from 'discord.js';
import type { TaskResult, TaskStatus } from '../agents/contracts.js';
import type { TaskRecord } from '../types.js';

export type TaskControlAction = 'inspect' | 'cancel';

export interface TaskControlSurface {
  update(thread: AnyThreadChannel, task: TaskRecord, result?: TaskResult): Promise<void>;
}

export interface TaskControlPayload {
  embeds: EmbedBuilder[];
  components: Array<ActionRowBuilder<ButtonBuilder>>;
}

const ACTIVE_STATUSES = new Set<TaskStatus>([
  'created',
  'starting',
  'running',
  'waiting_for_user',
]);

export function taskControlCustomId(action: TaskControlAction, taskId: string): string {
  const value = `task-control:${action}:${taskId}`;
  if (value.length > 100) throw new Error('Task control custom ID exceeds Discord limits');
  return value;
}

export function parseTaskControlCustomId(
  customId: string,
): { action: TaskControlAction; taskId: string } | undefined {
  const match = /^task-control:(inspect|cancel):(.+)$/.exec(customId);
  if (!match) return undefined;
  return { action: match[1] as TaskControlAction, taskId: match[2] };
}

export function buildTaskControlPayload(
  task: TaskRecord,
  result?: TaskResult,
): TaskControlPayload {
  const fields = [
    { name: 'Project', value: task.projectName, inline: true },
    { name: 'Provider', value: task.provider, inline: true },
    { name: 'State', value: task.status, inline: true },
  ];

  if (result?.branchName) {
    fields.push({ name: 'Branch', value: truncate(result.branchName, 1_024), inline: false });
  }
  if (result?.summary) {
    fields.push({ name: 'Result', value: truncate(result.summary, 1_024), inline: false });
  }
  if (result?.verification?.length) {
    fields.push({
      name: 'Verification',
      value: truncate(result.verification.map(item => `• ${item}`).join('\n'), 1_024),
      inline: false,
    });
  }

  const footer = ACTIVE_STATUSES.has(task.status)
    ? 'Use the controls below or continue the conversation in this thread.'
    : task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted'
      ? 'Send a new message in this thread to continue the preserved task explicitly.'
      : 'This task is terminal. Use Inspect for its durable record.';

  const embed = new EmbedBuilder()
    .setTitle('Task controls')
    .setDescription(truncate(task.objective, 4_096))
    .addFields(fields)
    .setFooter({ text: footer })
    .setTimestamp(task.updatedAt);

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(taskControlCustomId('inspect', task.id))
      .setLabel('Inspect')
      .setStyle(ButtonStyle.Secondary),
  );

  if (ACTIVE_STATUSES.has(task.status)) {
    controls.addComponents(
      new ButtonBuilder()
        .setCustomId(taskControlCustomId('cancel', task.id))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    );
  }

  return { embeds: [embed], components: [controls] };
}

export class DiscordTaskControlSurface implements TaskControlSurface {
  async update(thread: AnyThreadChannel, task: TaskRecord, result?: TaskResult): Promise<void> {
    const payload = buildTaskControlPayload(task, result);
    const messages = await thread.messages.fetch({ limit: 50 });
    const existing = [...messages.values()].find(message => isTaskControlMessage(message, task.id));
    if (existing) {
      await existing.edit(payload);
      return;
    }
    await thread.send(payload);
  }
}

function isTaskControlMessage(message: Message | unknown, taskId: string): message is Message {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as {
    author?: { id?: string };
    edit?: unknown;
    components?: Array<{ components?: Array<{ customId?: string }> }>;
  };
  if (typeof candidate.edit !== 'function') return false;
  const botId = (message as { client?: { user?: { id?: string } } }).client?.user?.id;
  if (botId && candidate.author?.id !== botId) return false;
  return candidate.components?.some(row => row.components?.some(component =>
    component.customId === taskControlCustomId('inspect', taskId),
  )) ?? false;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

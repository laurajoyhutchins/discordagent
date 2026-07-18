import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { AgentProviderId, TaskResult, TaskStatus } from '../agents/contracts.js';
import { providerLabel } from '../agents/providerLabels.js';
import type { TaskControlCardRecord, TaskControlCardPinState } from '../types.js';
import { redactSensitiveText } from '../utils/redaction.js';
import {
  operatorEmbed,
  sessionStateLabel,
  taskStatusLabel,
  taskStatusTone,
} from './presentation.js';

const PLAIN_TEXT_LIMIT = 1_900;
const EMBED_OUTPUT_LIMIT = 4_000;
const ACTIVE_STATUSES = new Set<TaskStatus>(['created', 'starting', 'running', 'waiting_for_user']);

export type TaskControlAction = 'inspect' | 'cancel';
export type TaskControlCardSessionState = 'not_started' | 'active' | 'preserved' | 'unavailable';

export interface TaskControlCardView {
  readonly taskId: string;
  readonly objective: string;
  readonly projectName: string;
  readonly provider: AgentProviderId;
  readonly model?: string;
  readonly status: TaskStatus;
  readonly branchName?: string;
  readonly sessionState: TaskControlCardSessionState;
  readonly phase?: string;
  readonly usagePosture?: string;
  readonly result?: TaskResult;
}

export interface TaskControlCardPayload {
  readonly content: string;
  readonly embeds?: readonly EmbedBuilder[];
  readonly components?: readonly ActionRowBuilder<ButtonBuilder>[];
}

export interface TaskControlCardStore {
  getControlCard(taskId: string): TaskControlCardRecord | undefined;
  saveControlCard(taskId: string, input: { messageId: string; pinState: TaskControlCardPinState }): void;
}

export interface TaskControlCardMessage {
  readonly id: string;
  edit(payload: unknown): Promise<unknown>;
  pin?(): Promise<unknown>;
}

export function taskControlCustomId(action: TaskControlAction): string {
  return `task-control:${action}`;
}

export function parseTaskControlCustomId(customId: string): TaskControlAction | undefined {
  if (customId === taskControlCustomId('inspect')) return 'inspect';
  if (customId === taskControlCustomId('cancel')) return 'cancel';
  return undefined;
}

function safe(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactSensitiveText(value);
}

function linesFor(view: TaskControlCardView, mode: 'plain' | 'rich'): string[] {
  const result = view.result;
  const rich = mode === 'rich';
  return [
    `Objective: ${safe(view.objective)}`,
    `Project: ${safe(view.projectName)}`,
    `Provider: ${rich ? providerLabel(view.provider) : view.provider}`,
    ...(view.model ? [`Model: ${safe(view.model)}`] : []),
    `State: ${view.status}`,
    ...(view.branchName ? [`Branch: ${safe(view.branchName)}`] : []),
    `Session: ${rich ? sessionStateLabel(view.sessionState) : view.sessionState}`,
    ...(view.phase ? [`${rich ? 'Current work' : 'Phase'}: ${safe(view.phase)}`] : []),
    ...(view.usagePosture && !['healthy', 'normal'].includes(view.usagePosture)
      ? [`Usage posture: ${safe(view.usagePosture)}`]
      : []),
    ...(result?.summary ? [`Outcome: ${safe(result.summary)}`] : []),
    ...(result?.unresolved?.length
      ? [`${rich ? 'Needs attention' : 'Unresolved decisions'}: ${result.unresolved.map(safe).join('; ')}`]
      : []),
  ];
}

function controlsFor(status: TaskStatus): readonly ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(taskControlCustomId('inspect'))
      .setLabel('Inspect')
      .setStyle(ButtonStyle.Secondary),
  );
  if (ACTIVE_STATUSES.has(status)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(taskControlCustomId('cancel'))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    );
  }
  return [row];
}

export function renderTaskControlCard(
  view: TaskControlCardView,
  options: { embeds: boolean },
): TaskControlCardPayload {
  const plainLines = linesFor(view, 'plain');
  const content = plainLines.join('\n').slice(0, PLAIN_TEXT_LIMIT);
  const components = controlsFor(view.status);
  if (!options.embeds) return { content, components };

  const [objective, ...fields] = linesFor(view, 'rich');
  const embed = operatorEmbed({
    title: `Task · ${taskStatusLabel(view.status)}`,
    description: objective.slice('Objective: '.length, 4_000),
    tone: taskStatusTone(view.status),
    footer: 'Durable task state · Use Inspect for details.',
  }).addFields(fields.map(line => {
    const separator = line.indexOf(': ');
    return {
      name: separator >= 0 ? line.slice(0, separator) : 'Status',
      value: (separator >= 0 ? line.slice(separator + 2) : line).slice(0, 1_024),
      inline: line.startsWith('Provider:') || line.startsWith('Model:') || line.startsWith('State:') || line.startsWith('Session:'),
    };
  }));
  if (JSON.stringify(embed.toJSON()).length > EMBED_OUTPUT_LIMIT) return { content, components };
  return { content: '', embeds: [embed], components };
}

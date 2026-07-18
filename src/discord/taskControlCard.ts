import { EmbedBuilder } from 'discord.js';
import type { AgentProviderId, TaskResult, TaskStatus } from '../agents/contracts.js';
import type { TaskControlCardRecord, TaskControlCardPinState } from '../types.js';
import { redactSensitiveText } from '../utils/redaction.js';

const PLAIN_TEXT_LIMIT = 1_900;
const EMBED_OUTPUT_LIMIT = 4_000;

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

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  created: 'created',
  starting: 'starting',
  running: 'running',
  waiting_for_user: 'waiting for user',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};

function safe(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactSensitiveText(value);
}

function linesFor(view: TaskControlCardView): string[] {
  const result = view.result;
  return [
    `Objective: ${safe(view.objective)}`,
    `Project: ${safe(view.projectName)}`,
    `Provider: ${view.provider}`,
    ...(view.model ? [`Model: ${safe(view.model)}`] : []),
    `State: ${STATUS_LABELS[view.status]}`,
    ...(view.branchName ? [`Branch: ${safe(view.branchName)}`] : []),
    `Session: ${view.sessionState}`,
    ...(view.phase ? [`Phase: ${safe(view.phase)}`] : []),
    ...(view.usagePosture && !['healthy', 'normal'].includes(view.usagePosture)
      ? [`Usage posture: ${safe(view.usagePosture)}`]
      : []),
    ...(result?.summary ? [`Outcome: ${safe(result.summary)}`] : []),
    ...(result?.unresolved?.length ? [`Unresolved decisions: ${result.unresolved.map(safe).join('; ')}`] : []),
  ];
}

export function renderTaskControlCard(
  view: TaskControlCardView,
  options: { embeds: boolean },
): TaskControlCardPayload {
  const lines = linesFor(view);
  const content = lines.join('\n').slice(0, PLAIN_TEXT_LIMIT);
  if (!options.embeds) return { content };

  const [objective, ...fields] = lines;
  const embed = new EmbedBuilder()
    .setTitle('Task control card')
    .setDescription(objective.slice('Objective: '.length, 4_000))
    .addFields(fields.map(line => {
      const separator = line.indexOf(': ');
      return {
        name: separator >= 0 ? line.slice(0, separator) : 'Status',
        value: (separator >= 0 ? line.slice(separator + 2) : line).slice(0, 1_024),
        inline: line.startsWith('Provider:') || line.startsWith('Model:') || line.startsWith('State:') || line.startsWith('Session:'),
      };
    }))
    .setFooter({ text: 'Durable task projection; SQLite remains authoritative.' });
  if (JSON.stringify(embed.toJSON()).length > EMBED_OUTPUT_LIMIT) return { content };
  return { content: '', embeds: [embed] };
}

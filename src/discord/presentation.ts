import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { TaskStatus } from '../agents/contracts.js';
import {
  evaluateCapability,
  type CapabilityPermissionChannel,
} from './capabilities/evaluator.js';

export type OperatorTone = 'neutral' | 'success' | 'attention' | 'danger';

const DISCORD_MESSAGE_LIMIT = 2_000;

const TONE_COLORS: Readonly<Record<OperatorTone, number>> = {
  neutral: 0x5865f2,
  success: 0x57f287,
  attention: 0xfee75c,
  danger: 0xed4245,
};

const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  created: 'Queued',
  starting: 'Starting',
  running: 'Running',
  waiting_for_user: 'Needs your input',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

const SESSION_STATE_LABELS: Readonly<Record<string, string>> = {
  not_started: 'Not started',
  active: 'Active',
  preserved: 'Preserved',
  unavailable: 'Unavailable',
};

export interface OperatorMessage {
  readonly embed: EmbedBuilder;
  readonly fallback: string;
}

export function operatorEmbed(input: {
  title: string;
  description?: string;
  tone?: OperatorTone;
  footer?: string;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(input.title)
    .setColor(TONE_COLORS[input.tone ?? 'neutral']);
  if (input.description) embed.setDescription(input.description);
  if (input.footer) embed.setFooter({ text: input.footer });
  return embed;
}

export async function operatorReplyPayload(
  interaction: Pick<ChatInputCommandInteraction, 'guild' | 'channel'>,
  message: OperatorMessage,
): Promise<{ embeds: [EmbedBuilder] } | { content: string }> {
  const guild = interaction.guild;
  let member = guild?.members.me ?? null;
  if (!member && guild) member = await guild.members.fetchMe().catch(() => null);

  const channel = interaction.channel as unknown as CapabilityPermissionChannel | null;
  const capability = evaluateCapability('core.message.embed', { member, channel });
  return capability.state === 'available'
    ? { embeds: [message.embed] }
    : { content: truncateDiscordText(message.fallback) };
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function taskStatusTone(status: TaskStatus): OperatorTone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'waiting_for_user' || status === 'interrupted') return 'attention';
  return 'neutral';
}

export function sessionStateLabel(state: string): string {
  return SESSION_STATE_LABELS[state] ?? sentenceCase(state);
}

export function formatEmptyState(input: {
  title: string;
  description: string;
  action?: string;
}): string {
  return [
    `**${input.title}**`,
    input.description,
    ...(input.action ? [`Next: ${input.action}`] : []),
  ].join('\n');
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll('_', ' ').trim();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : value;
}

function truncateDiscordText(value: string): string {
  if (value.length <= DISCORD_MESSAGE_LIMIT) return value;
  return `${value.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

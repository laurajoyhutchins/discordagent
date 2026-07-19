import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  type AnyThreadChannel,
  type ButtonInteraction,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  type MessageReplyOptions,
} from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import {
  createMessageDeliveryContext,
  deliverPresentation,
} from '../discord/presentationDelivery.js';
import type {
  LoopRepository,
  ScheduledLoopRecord,
} from '../repositories/loopRepository.js';
import type { Project } from '../types.js';
import {
  createScheduledLoopService,
  type ScheduledLoopExecutionResult,
  type ScheduledLoopService,
} from './scheduledLoopService.js';

export type LoopScheduler = (
  callback: () => Promise<void>,
  delayMs: number,
) => ReturnType<typeof setTimeout>;

export interface LoopRunnerConfiguration {
  readonly repository: LoopRepository;
  readonly coordinator: Pick<TaskCoordinator, 'startInExistingThread' | 'continueInThread'>;
  readonly fetchThread: (threadId: string) => Promise<AnyThreadChannel | null>;
  readonly findProject: (projectName: string) => Project | undefined;
  readonly schedule?: LoopScheduler;
  readonly clearSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly now?: () => number;
  readonly logger?: (message: string) => void;
}

export interface LoopRunnerDependencies {
  readonly service?: ScheduledLoopService;
  readonly logger?: (message: string) => void;
}

const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;
const DEFAULT_INTERVAL_MS = 10 * 60_000;
const DISCORD_MESSAGE_LIMIT = 2_000;
const PROMPT_TEXT_LIMIT = 1_024;
const NO_MENTIONS = { parse: [] as never[] };

let configuredService: ScheduledLoopService | undefined;
let configuredLogger: (message: string) => void = message => console.warn(message);

export function configureLoopRunner(
  configuration: LoopRunnerConfiguration,
): ScheduledLoopService {
  configuredService?.detachAll();
  configuredLogger = configuration.logger ?? (message => console.warn(message));
  configuredService = createScheduledLoopService({
    repository: configuration.repository,
    coordinator: undefined as never,
    fetchThread: configuration.fetchThread,
    findProject: configuration.findProject,
    executeIteration: (loop, project, thread) => executeIteration(
      loop,
      project,
      thread,
      configuration.coordinator,
      configuredLogger,
    ),
    presentWaiting: (loop, project, thread) => presentWaiting(
      loop,
      project,
      thread,
      configuredLogger,
    ),
    ...(configuration.schedule ? { schedule: configuration.schedule } : {}),
    ...(configuration.clearSchedule ? { clearSchedule: configuration.clearSchedule } : {}),
    ...(configuration.now ? { now: configuration.now } : {}),
    logger: configuredLogger,
  } as Parameters<typeof createScheduledLoopService>[0]);
  return configuredService;
}

function service(injected?: LoopRunnerDependencies): ScheduledLoopService {
  const selected = injected?.service ?? configuredService;
  if (!selected) {
    throw new Error('Scheduled loop runtime is not initialized');
  }
  return selected;
}

export async function reconcileScheduledLoops(): Promise<void> {
  await service().reconcile();
}

export function clearLoopRunner(): void {
  configuredService?.detachAll();
  configuredService = undefined;
}

export function parseDuration(input: string): number | null {
  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = input.match(pattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
  return ms > 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);
  return parts.join('') || '0s';
}

function discordTimestamp(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function makeStopButton(channelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`loop_stop_${channelId}`)
      .setLabel('Stop Loop')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️'),
  );
}

function threadLabel(prompt: string): string {
  return prompt.slice(0, 80);
}

async function setThreadName(thread: AnyThreadChannel, name: string): Promise<void> {
  try {
    await thread.setName(name.slice(0, 100));
  } catch {
    // Thread naming is cosmetic and must not affect scheduling.
  }
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function truncateDiscordMessage(text: string): string {
  return truncateText(text, DISCORD_MESSAGE_LIMIT);
}

function makeStartedText(prompt: string, intervalMs: number): string {
  return truncateDiscordMessage([
    '🔁 **Loop started**',
    `**Prompt:** ${truncateText(prompt, PROMPT_TEXT_LIMIT)}`,
    `**Interval:** ${formatDuration(intervalMs)}`,
    '**Status:** Running first iteration...',
    'Use `/stop-loop` or click **Stop Loop** to cancel.',
  ].join('\n'));
}

function makeIterationText(iteration: number): string {
  return `🔁 **Iteration #${iteration}**`;
}

function makeWaitingText(loop: ScheduledLoopRecord): string {
  const nextRun = loop.nextRunAt === undefined
    ? 'not scheduled'
    : discordTimestamp(loop.nextRunAt);
  return truncateDiscordMessage([
    `🔁✅ **Iteration #${loop.iteration} complete**`,
    `**Next iteration:** ${nextRun}`,
    `**Interval:** ${formatDuration(loop.intervalMs)}`,
    'Use `/stop-loop` or click **Stop Loop** to cancel.',
  ].join('\n'));
}

function makeStoppedText(loop: ScheduledLoopRecord, stoppedBy?: string): string {
  return truncateDiscordMessage([
    '⏹️ **Loop stopped**',
    `**Prompt:** ${truncateText(loop.prompt, PROMPT_TEXT_LIMIT)}`,
    `**Iterations completed:** ${loop.iteration}`,
    `**Ran for:** ${formatDuration((loop.stoppedAt ?? Date.now()) - loop.startedAt)}`,
    ...(stoppedBy ? [`**Stopped by:** ${stoppedBy}`] : []),
  ].join('\n'));
}

function messageSendCapabilityId(channel: unknown): 'core.message.send' | 'task.thread.send' {
  const isThread = (channel as { isThread?: () => boolean }).isThread;
  return typeof isThread === 'function' && isThread.call(channel)
    ? 'task.thread.send'
    : 'core.message.send';
}

export function parseLoopCommand(content: string): { intervalMs: number; prompt: string } | null {
  const rest = content.replace(/^\/loop\s*/, '').trim();
  if (!rest) return null;
  const tokens = rest.split(/\s+/);
  const maybeDuration = parseDuration(tokens[0]);
  if (maybeDuration !== null) {
    const prompt = tokens.slice(1).join(' ').trim();
    return prompt ? { intervalMs: maybeDuration, prompt } : null;
  }
  return { intervalMs: DEFAULT_INTERVAL_MS, prompt: rest };
}

async function executeIteration(
  loop: ScheduledLoopRecord,
  project: Project,
  thread: AnyThreadChannel,
  coordinator: Pick<TaskCoordinator, 'startInExistingThread' | 'continueInThread'>,
  logger: (message: string) => void,
): Promise<ScheduledLoopExecutionResult | void> {
  await setThreadName(thread, `🔁⏳ Loop: ${threadLabel(loop.prompt)}`);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🔁 Iteration #${loop.iteration}`)
    .setTimestamp();
  const delivery = await deliverPresentation<MessageCreateOptions>({
    context: createMessageDeliveryContext(thread),
    sendCapabilityId: 'task.thread.send',
    send: payload => thread.send(payload),
    rich: { embeds: [embed] },
    fallback: {
      content: makeIterationText(loop.iteration),
      allowedMentions: NO_MENTIONS,
    },
    label: `Loop iteration ${loop.iteration} for ${project.name}`,
    logger,
  });
  if (!delivery.delivered) {
    return { terminalReason: 'Discord loop thread cannot receive iteration messages' };
  }

  if (loop.iteration === 1) {
    await coordinator.startInExistingThread({
      projectName: project.name,
      prompt: loop.prompt,
      thread,
      provider: project.defaultProvider,
    });
  } else {
    await coordinator.continueInThread({ prompt: loop.prompt, thread });
  }
}

async function presentWaiting(
  loop: ScheduledLoopRecord,
  project: Project,
  thread: AnyThreadChannel,
  logger: (message: string) => void,
): Promise<ScheduledLoopExecutionResult | void> {
  if (loop.nextRunAt === undefined) {
    return { terminalReason: 'Loop waiting state has no next-run timestamp' };
  }
  await setThreadName(thread, `🔁✅ Loop: ${threadLabel(loop.prompt)}`);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🔁✅ Iteration #${loop.iteration} complete`)
    .addFields(
      { name: 'Next iteration', value: discordTimestamp(loop.nextRunAt), inline: true },
      { name: 'Interval', value: formatDuration(loop.intervalMs), inline: true },
    )
    .setFooter({ text: 'Use /stop-loop or click Stop Loop to cancel' })
    .setTimestamp();
  const components = [makeStopButton(loop.channelId)];
  const delivery = await deliverPresentation<MessageCreateOptions>({
    context: createMessageDeliveryContext(thread),
    sendCapabilityId: 'task.thread.send',
    send: payload => thread.send(payload),
    rich: { embeds: [embed], components },
    fallback: {
      content: makeWaitingText(loop),
      components,
      allowedMentions: NO_MENTIONS,
    },
    label: `Loop waiting state for ${project.name}`,
    logger,
  });
  return delivery.delivered
    ? undefined
    : { terminalReason: 'Discord loop thread cannot receive waiting-state messages' };
}

export async function startLoop(
  intervalMs: number,
  prompt: string,
  project: Project,
  message: Message,
  injected?: LoopRunnerDependencies,
): Promise<void> {
  const loopService = service(injected);
  const logger = injected?.logger ?? configuredLogger;
  const channelId = project.agentChannelId;

  if (intervalMs < MIN_INTERVAL_MS) {
    await message.reply(`Interval too short. Minimum is ${formatDuration(MIN_INTERVAL_MS)}.`);
    return;
  }
  if (intervalMs > MAX_INTERVAL_MS) {
    await message.reply(`Interval too long. Maximum is ${formatDuration(MAX_INTERVAL_MS)}.`);
    return;
  }

  const existing = loopService.findActiveByChannelId(channelId);
  if (existing) {
    const next = existing.nextRunAt
      ? `Next iteration ${discordTimestamp(existing.nextRunAt)}.`
      : 'Currently running an iteration.';
    await message.reply(
      `A loop is already running in this channel (iteration #${existing.iteration}, every ${formatDuration(existing.intervalMs)}). `
      + `${next}\nUse \`/stop-loop\` or click the **Stop Loop** button to stop it first.`,
    );
    return;
  }

  if (message.channel.type !== ChannelType.GuildText) {
    await message.reply('Loops can only be started in text channels.');
    return;
  }

  const thread = await message.startThread({
    name: `🔁⏳ Loop: ${threadLabel(prompt)}`,
    autoArchiveDuration: 60,
  });
  const startEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔁 Loop started')
    .addFields(
      { name: 'Prompt', value: prompt.slice(0, 1024) },
      { name: 'Interval', value: formatDuration(intervalMs), inline: true },
      { name: 'Status', value: 'Running first iteration...', inline: true },
    )
    .setFooter({ text: 'Use /stop-loop or click Stop Loop to cancel' })
    .setTimestamp();
  const components = [makeStopButton(channelId)];
  const delivered = await deliverPresentation<MessageCreateOptions>({
    context: createMessageDeliveryContext(thread),
    sendCapabilityId: 'task.thread.send',
    send: payload => thread.send(payload),
    rich: { embeds: [startEmbed], components },
    fallback: {
      content: makeStartedText(prompt, intervalMs),
      components,
      allowedMentions: NO_MENTIONS,
    },
    label: `Loop start for ${project.name}`,
    logger,
  });
  if (!delivered.delivered) {
    logger(`[loop] Loop start presentation was not delivered; no durable loop was created.`);
    return;
  }

  try {
    await loopService.createAndStart({
      id: randomUUID(),
      projectName: project.name,
      channelId,
      threadId: thread.id,
      prompt,
      intervalMs,
      startedBy: message.author.id,
    }, project, thread);
  } catch (error) {
    logger(`[loop] Failed to persist or start loop for ${project.name}: ${String(error)}`);
    await thread.send({
      content: 'The loop could not be persisted and was not scheduled. Check the host logs before retrying.',
      allowedMentions: NO_MENTIONS,
    }).catch(() => undefined);
  }
}

export async function stopLoop(
  channelId: string,
  message: Message,
  injected?: LoopRunnerDependencies,
): Promise<void> {
  const loopService = service(injected);
  const loop = loopService.stopByChannel(channelId, 'Stopped by user command');
  if (!loop) {
    await message.reply('No loop is running in this channel.');
    return;
  }
  const embed = makeStoppedEmbed(loop);
  await deliverPresentation<MessageReplyOptions>({
    context: createMessageDeliveryContext(message.channel),
    sendCapabilityId: messageSendCapabilityId(message.channel),
    send: payload => message.reply(payload),
    rich: { embeds: [embed] },
    fallback: { content: makeStoppedText(loop), allowedMentions: NO_MENTIONS },
    label: `Loop stopped state for ${loop.projectName}`,
    logger: injected?.logger ?? configuredLogger,
  });
}

export async function stopLoopFromButton(
  channelId: string,
  interaction: ButtonInteraction,
  injected?: LoopRunnerDependencies,
): Promise<void> {
  const loopService = service(injected);
  const loop = loopService.stopByChannel(channelId, `Stopped by Discord user ${interaction.user.id}`);
  if (!loop) {
    await interaction.reply({ content: 'No loop is running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  const stoppedBy = `<@${interaction.user.id}>`;
  const embed = makeStoppedEmbed(loop)
    .addFields({ name: 'Stopped by', value: stoppedBy, inline: true });
  await deliverPresentation<InteractionReplyOptions>({
    context: createMessageDeliveryContext(interaction.channel),
    sendCapabilityId: messageSendCapabilityId(interaction.channel),
    send: payload => interaction.reply(payload),
    rich: { embeds: [embed] },
    fallback: {
      content: makeStoppedText(loop, stoppedBy),
      allowedMentions: { users: [interaction.user.id], parse: [] },
    },
    label: `Loop stopped interaction for ${loop.projectName}`,
    logger: injected?.logger ?? configuredLogger,
  });
}

export function cancelLoop(
  channelId: string,
  injected?: LoopRunnerDependencies,
): number | null {
  const loop = service(injected).stopByChannel(channelId, 'Cancelled by task command');
  return loop?.iteration ?? null;
}

function makeStoppedEmbed(loop: ScheduledLoopRecord): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⏹️ Loop stopped')
    .addFields(
      { name: 'Prompt', value: loop.prompt.slice(0, 1024) },
      { name: 'Iterations completed', value: String(loop.iteration), inline: true },
      {
        name: 'Ran for',
        value: formatDuration((loop.stoppedAt ?? Date.now()) - loop.startedAt),
        inline: true,
      },
    )
    .setTimestamp();
}

export function getLoop(
  channelId: string,
  injected?: LoopRunnerDependencies,
): ScheduledLoopRecord | undefined {
  return service(injected).findActiveByChannelId(channelId);
}

export function getLoopChannelForThread(
  threadId: string,
  injected?: LoopRunnerDependencies,
): string | undefined {
  return service(injected).findActiveByThreadId(threadId)?.channelId;
}

export function getLoopStatus(
  channelId: string,
  injected?: LoopRunnerDependencies,
): string | null {
  const loop = service(injected).findActiveByChannelId(channelId);
  if (!loop) return null;
  const next = loop.nextRunAt
    ? `Next iteration ${discordTimestamp(loop.nextRunAt)}`
    : 'Currently running an iteration';
  return (
    `🔁 **Loop active** — every ${formatDuration(loop.intervalMs)}\n`
    + `**Prompt:** ${loop.prompt.slice(0, 200)}\n`
    + `**Iteration:** #${loop.iteration} | **Running since:** ${discordTimestamp(loop.startedAt)}\n`
    + `**Status:** ${next}`
  );
}

export function terminalizeLoopByThread(
  threadId: string,
  reason: string,
  injected?: LoopRunnerDependencies,
): ScheduledLoopRecord | undefined {
  return service(injected).terminalizeByThread(threadId, reason);
}

export function terminalizeLoopByChannel(
  channelId: string,
  reason: string,
  injected?: LoopRunnerDependencies,
): ScheduledLoopRecord | undefined {
  return service(injected).terminalizeByChannel(channelId, reason);
}

export function terminalizeLoopsByProject(
  projectName: string,
  reason: string,
  injected?: LoopRunnerDependencies,
): ScheduledLoopRecord[] {
  return service(injected).terminalizeByProject(projectName, reason);
}

export function stopAllLoops(): void {
  configuredService?.detachAll();
}

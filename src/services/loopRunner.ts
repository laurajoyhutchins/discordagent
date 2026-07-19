import {
  Message,
  AnyThreadChannel,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  MessageFlags,
  type InteractionReplyOptions,
  type MessageCreateOptions,
  type MessageReplyOptions,
} from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import {
  createMessageDeliveryContext,
  deliverPresentation,
} from '../discord/presentationDelivery.js';
import { getTaskCoordinator } from './taskCoordinatorService.js';
import type { Project } from '../types.js';
import { redactErrorMessage } from '../utils/redaction.js';

interface ActiveLoop {
  id: string;
  prompt: string;
  intervalMs: number;
  project: Project;
  channelId: string;
  threadId: string | null;           // the single thread all iterations run in
  startedBy: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  iteration: number;
  stopped: boolean;
  nextIterationAt: number | null;
  thread: AnyThreadChannel;
  coordinator: Pick<TaskCoordinator, 'startInExistingThread' | 'continueInThread'>;
  schedule: LoopScheduler;
  logger: (message: string) => void;
}

export type LoopScheduler = (
  callback: () => Promise<void>,
  delayMs: number,
) => ReturnType<typeof setTimeout>;

export interface LoopRunnerDependencies {
  coordinator: Pick<TaskCoordinator, 'startInExistingThread' | 'continueInThread'>;
  schedule: LoopScheduler;
  logger?: (message: string) => void;
}

function defaultLoopDependencies(): LoopRunnerDependencies {
  return {
    coordinator: getTaskCoordinator(),
    schedule: (callback, delayMs) => setTimeout(() => { void callback(); }, delayMs),
    logger: message => console.warn(message),
  };
}

const activeLoops = new Map<string, ActiveLoop>();

// Reverse map: threadId → channelId (so /stop-loop works from the thread)
const loopThreads = new Map<string, string>();

const MIN_INTERVAL_MS = 60_000;       // 1 minute minimum
const MAX_INTERVAL_MS = 24 * 60 * 60_000; // 24 hours maximum
const DEFAULT_INTERVAL_MS = 10 * 60_000;  // 10 minutes default
const DISCORD_MESSAGE_LIMIT = 2_000;
const PROMPT_TEXT_LIMIT = 1_024;
const NO_MENTIONS = { parse: [] as never[] };

// ── Helpers ────────────────────────────────────────────────────────────

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
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:R>`;
}

function makeStopButton(channelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`loop_stop_${channelId}`)
      .setLabel('Stop Loop')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️')
  );
}

function threadLabel(prompt: string): string {
  return prompt.slice(0, 80);
}

async function setThreadName(thread: AnyThreadChannel, name: string): Promise<void> {
  try { await thread.setName(name.slice(0, 100)); } catch {}
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

function makeWaitingText(iteration: number, nextIterationAt: number, intervalMs: number): string {
  return truncateDiscordMessage([
    `🔁✅ **Iteration #${iteration} complete**`,
    `**Next iteration:** ${discordTimestamp(nextIterationAt)}`,
    `**Interval:** ${formatDuration(intervalMs)}`,
    'Use `/stop-loop` or click **Stop Loop** to cancel.',
  ].join('\n'));
}

function makeStoppedText(loop: ActiveLoop, stoppedBy?: string): string {
  return truncateDiscordMessage([
    '⏹️ **Loop stopped**',
    `**Prompt:** ${truncateText(loop.prompt, PROMPT_TEXT_LIMIT)}`,
    `**Iterations completed:** ${loop.iteration}`,
    `**Ran for:** ${formatDuration(Date.now() - loop.startedAt)}`,
    ...(stoppedBy ? [`**Stopped by:** ${stoppedBy}`] : []),
  ].join('\n'));
}

function messageSendCapabilityId(channel: unknown): 'core.message.send' | 'task.thread.send' {
  const isThread = (channel as { isThread?: () => boolean }).isThread;
  return typeof isThread === 'function' && isThread.call(channel)
    ? 'task.thread.send'
    : 'core.message.send';
}

// ── parseLoopCommand ───────────────────────────────────────────────────

export function parseLoopCommand(content: string): { intervalMs: number; prompt: string } | null {
  const rest = content.replace(/^\/loop\s*/, '').trim();
  if (!rest) return null;

  const tokens = rest.split(/\s+/);
  const maybeDuration = parseDuration(tokens[0]);

  if (maybeDuration !== null) {
    const prompt = tokens.slice(1).join(' ').trim();
    if (!prompt) return null;
    return { intervalMs: maybeDuration, prompt };
  }

  return { intervalMs: DEFAULT_INTERVAL_MS, prompt: rest };
}

// ── startLoop ──────────────────────────────────────────────────────────

export async function startLoop(
  intervalMs: number,
  prompt: string,
  project: Project,
  message: Message,
  injected?: LoopRunnerDependencies,
): Promise<void> {
  const channelId = project.agentChannelId;
  const dependencies = injected ?? defaultLoopDependencies();
  const logger = dependencies.logger ?? (entry => console.warn(entry));

  // Validate interval
  if (intervalMs < MIN_INTERVAL_MS) {
    await message.reply(`Interval too short. Minimum is ${formatDuration(MIN_INTERVAL_MS)}.`);
    return;
  }
  if (intervalMs > MAX_INTERVAL_MS) {
    await message.reply(`Interval too long. Maximum is ${formatDuration(MAX_INTERVAL_MS)}.`);
    return;
  }

  // Check for existing loop
  if (activeLoops.has(channelId)) {
    const existing = activeLoops.get(channelId)!;
    const nextStr = existing.nextIterationAt
      ? `Next iteration ${discordTimestamp(existing.nextIterationAt)}.`
      : 'Currently running an iteration.';
    await message.reply(
      `A loop is already running in this channel (iteration #${existing.iteration}, every ${formatDuration(existing.intervalMs)}). `
      + `${nextStr}\nUse \`/stop-loop\` or click the **Stop Loop** button to stop it first.`
    );
    return;
  }

  // Verify channel type
  const channel = message.channel;
  if (channel.type !== ChannelType.GuildText) {
    await message.reply('Loops can only be started in text channels.');
    return;
  }

  const loopId = `loop-${channelId}-${Date.now()}`;

  // Create a single thread for the entire loop
  const thread = await message.startThread({
    name: `🔁⏳ Loop: ${threadLabel(prompt)}`,
    autoArchiveDuration: 60,
  });

  // Send start presentation inside the thread
  const startEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔁 Loop started')
    .addFields(
      { name: 'Prompt', value: prompt.slice(0, 1024) },
      { name: 'Interval', value: formatDuration(intervalMs), inline: true },
      { name: 'Status', value: 'Running first iteration...', inline: true }
    )
    .setFooter({ text: 'Use /stop-loop or click Stop Loop to cancel' })
    .setTimestamp();
  const startComponents = [makeStopButton(channelId)];
  const startDelivery = await deliverPresentation<MessageCreateOptions>({
    context: createMessageDeliveryContext(thread),
    sendCapabilityId: 'task.thread.send',
    send: payload => thread.send(payload),
    rich: { embeds: [startEmbed], components: startComponents },
    fallback: {
      content: makeStartedText(prompt, intervalMs),
      components: startComponents,
      allowedMentions: NO_MENTIONS,
    },
    label: `Loop start for ${project.name}`,
    logger,
  });
  if (!startDelivery.delivered) {
    logger(`[loop] Loop start presentation was not delivered; loop ${loopId} was not scheduled.`);
    return;
  }

  const loop: ActiveLoop = {
    id: loopId,
    prompt,
    intervalMs,
    project,
    channelId,
    threadId: thread.id,
    startedBy: message.author.id,
    startedAt: Date.now(),
    timer: null,
    iteration: 0,
    stopped: false,
    nextIterationAt: null,
    thread,
    coordinator: dependencies.coordinator,
    schedule: dependencies.schedule,
    logger,
  };

  activeLoops.set(channelId, loop);
  loopThreads.set(thread.id, channelId);

  // Use setTimeout chaining to prevent overlapping iterations
  const runIteration = async () => {
    if (loop.stopped || !activeLoops.has(channelId)) return;

    loop.iteration++;
    loop.nextIterationAt = null;

    // Update thread name to show working
    await setThreadName(thread, `🔁⏳ Loop: ${threadLabel(prompt)}`);

    try {
      // Send iteration header
      const iterEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`🔁 Iteration #${loop.iteration}`)
        .setTimestamp();

      await deliverPresentation<MessageCreateOptions>({
        context: createMessageDeliveryContext(thread),
        sendCapabilityId: 'task.thread.send',
        send: payload => thread.send(payload),
        rich: { embeds: [iterEmbed] },
        fallback: {
          content: makeIterationText(loop.iteration),
          allowedMentions: NO_MENTIONS,
        },
        label: `Loop iteration ${loop.iteration} for ${project.name}`,
        logger: loop.logger,
      });

      if (loop.iteration === 1) {
        await loop.coordinator.startInExistingThread({
          projectName: project.name,
          prompt,
          thread,
          provider: project.defaultProvider,
        });
      } else {
        await loop.coordinator.continueInThread({ prompt, thread });
      }
    } catch (err) {
      console.error(`[loop] Iteration ${loop.iteration} failed:`, redactErrorMessage(err));
    }

    // Schedule next iteration (only after current one finishes)
    if (!loop.stopped && activeLoops.has(channelId)) {
      loop.nextIterationAt = Date.now() + intervalMs;

      // Update thread name to show idle + next time
      await setThreadName(thread, `🔁✅ Loop: ${threadLabel(prompt)}`);

      // Send waiting presentation with stop button
      const waitEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🔁✅ Iteration #${loop.iteration} complete`)
        .addFields(
          { name: 'Next iteration', value: discordTimestamp(loop.nextIterationAt), inline: true },
          { name: 'Interval', value: formatDuration(intervalMs), inline: true }
        )
        .setFooter({ text: 'Use /stop-loop or click Stop Loop to cancel' })
        .setTimestamp();
      const waitComponents = [makeStopButton(channelId)];

      await deliverPresentation<MessageCreateOptions>({
        context: createMessageDeliveryContext(thread),
        sendCapabilityId: 'task.thread.send',
        send: payload => thread.send(payload),
        rich: { embeds: [waitEmbed], components: waitComponents },
        fallback: {
          content: makeWaitingText(loop.iteration, loop.nextIterationAt, intervalMs),
          components: waitComponents,
          allowedMentions: NO_MENTIONS,
        },
        label: `Loop waiting state for ${project.name}`,
        logger: loop.logger,
      });

      loop.timer = loop.schedule(runIteration, intervalMs);
    }
  };

  // Run first iteration immediately
  await runIteration();
}

// ── stopLoop (from message) ────────────────────────────────────────────

export async function stopLoop(channelId: string, message: Message): Promise<void> {
  const loop = activeLoops.get(channelId);
  if (!loop) {
    await message.reply('No loop is running in this channel.');
    return;
  }

  await doStopLoop(loop, channelId);

  const embed = makeStoppedEmbed(loop);
  await deliverPresentation<MessageReplyOptions>({
    context: createMessageDeliveryContext(message.channel),
    sendCapabilityId: messageSendCapabilityId(message.channel),
    send: payload => message.reply(payload),
    rich: { embeds: [embed] },
    fallback: {
      content: makeStoppedText(loop),
      allowedMentions: NO_MENTIONS,
    },
    label: `Loop stopped state for ${loop.project.name}`,
    logger: loop.logger,
  });
}

// ── stopLoopFromButton ─────────────────────────────────────────────────

export async function stopLoopFromButton(channelId: string, interaction: ButtonInteraction): Promise<void> {
  const loop = activeLoops.get(channelId);
  if (!loop) {
    await interaction.reply({ content: 'No loop is running in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await doStopLoop(loop, channelId);

  const stoppedBy = `<@${interaction.user.id}>`;
  const embed = makeStoppedEmbed(loop)
    .addFields({ name: 'Stopped by', value: stoppedBy, inline: true });

  await deliverPresentation<InteractionReplyOptions>({
    context: createMessageDeliveryContext(loop.thread),
    sendCapabilityId: 'task.thread.send',
    send: payload => interaction.reply(payload),
    rich: { embeds: [embed] },
    fallback: {
      content: makeStoppedText(loop, stoppedBy),
      allowedMentions: { users: [interaction.user.id], parse: [] },
    },
    label: `Loop stopped interaction for ${loop.project.name}`,
    logger: loop.logger,
  });
}

// ── cancelLoop (silent, from /cancel) ──────────────────────────────────

export function cancelLoop(channelId: string): number | null {
  const loop = activeLoops.get(channelId);
  if (!loop) return null;

  void doStopLoop(loop, channelId);
  return loop.iteration;
}

// ── Shared stop logic ──────────────────────────────────────────────────

async function doStopLoop(loop: ActiveLoop, channelId: string): Promise<void> {
  loop.stopped = true;
  if (loop.timer) clearTimeout(loop.timer);

  if (loop.threadId) {
    loopThreads.delete(loop.threadId);
  }

  activeLoops.delete(channelId);
}

function makeStoppedEmbed(loop: ActiveLoop): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⏹️ Loop stopped')
    .addFields(
      { name: 'Prompt', value: loop.prompt.slice(0, 1024) },
      { name: 'Iterations completed', value: String(loop.iteration), inline: true },
      { name: 'Ran for', value: formatDuration(Date.now() - loop.startedAt), inline: true }
    )
    .setTimestamp();
}

// ── Query helpers ──────────────────────────────────────────────────────

export function getLoop(channelId: string): ActiveLoop | undefined {
  return activeLoops.get(channelId);
}

/**
 * Look up which channel a loop thread belongs to (for /stop-loop in thread).
 */
export function getLoopChannelForThread(threadId: string): string | undefined {
  return loopThreads.get(threadId);
}

export function getLoopStatus(channelId: string): string | null {
  const loop = activeLoops.get(channelId);
  if (!loop) return null;

  const nextStr = loop.nextIterationAt
    ? `Next iteration ${discordTimestamp(loop.nextIterationAt)}`
    : 'Currently running an iteration';

  return (
    `🔁 **Loop active** — every ${formatDuration(loop.intervalMs)}\n`
    + `**Prompt:** ${loop.prompt.slice(0, 200)}\n`
    + `**Iteration:** #${loop.iteration} | **Running since:** ${discordTimestamp(loop.startedAt)}\n`
    + `**Status:** ${nextStr}`
  );
}

export function stopAllLoops(): void {
  for (const loop of activeLoops.values()) {
    loop.stopped = true;
    if (loop.timer) clearTimeout(loop.timer);
  }
  activeLoops.clear();
  loopThreads.clear();
}

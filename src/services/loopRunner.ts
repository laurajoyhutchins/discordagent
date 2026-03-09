import { Message, TextChannel, AnyThreadChannel, EmbedBuilder } from 'discord.js';
import { runClaude } from './claudeRunner.js';
import type { Project } from '../types.js';

interface ActiveLoop {
  id: string;
  prompt: string;
  intervalMs: number;
  project: Project;
  channelId: string;
  startedBy: string;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  iteration: number;
}

const activeLoops = new Map<string, ActiveLoop>();

const MIN_INTERVAL_MS = 60_000;       // 1 minute minimum
const MAX_INTERVAL_MS = 24 * 60 * 60_000; // 24 hours maximum
const DEFAULT_INTERVAL_MS = 10 * 60_000;  // 10 minutes default

/**
 * Parse a duration string like "5m", "1h", "30s", "2h30m" into milliseconds.
 */
export function parseDuration(input: string): number | null {
  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = input.match(pattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Format milliseconds into a human-readable duration.
 */
function formatDuration(ms: number): string {
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

/**
 * Parse a /loop command message.
 * Formats:
 *   /loop 5m do something         — run "do something" every 5 minutes
 *   /loop do something            — run "do something" every 10 minutes (default)
 */
export function parseLoopCommand(content: string): { intervalMs: number; prompt: string } | null {
  // Remove the "/loop" prefix
  const rest = content.replace(/^\/loop\s*/, '').trim();
  if (!rest) return null;

  // Try to parse first token as a duration
  const tokens = rest.split(/\s+/);
  const maybeDuration = parseDuration(tokens[0]);

  if (maybeDuration !== null) {
    const prompt = tokens.slice(1).join(' ').trim();
    if (!prompt) return null;
    return { intervalMs: maybeDuration, prompt };
  }

  // No duration — use default interval, entire rest is the prompt
  return { intervalMs: DEFAULT_INTERVAL_MS, prompt: rest };
}

/**
 * Start a loop that runs a prompt on a recurring interval.
 */
export async function startLoop(
  intervalMs: number,
  prompt: string,
  project: Project,
  message: Message
): Promise<void> {
  const channelId = project.claudeChannelId;

  // Validate interval
  if (intervalMs < MIN_INTERVAL_MS) {
    await message.reply(`Interval too short. Minimum is ${formatDuration(MIN_INTERVAL_MS)}.`);
    return;
  }
  if (intervalMs > MAX_INTERVAL_MS) {
    await message.reply(`Interval too long. Maximum is ${formatDuration(MAX_INTERVAL_MS)}.`);
    return;
  }

  // Check for existing loop on this channel
  if (activeLoops.has(channelId)) {
    await message.reply(
      'A loop is already running in this channel. Use `/stop-loop` to stop it first.'
    );
    return;
  }

  const loopId = `loop-${channelId}-${Date.now()}`;

  // Send confirmation embed
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🔁 Loop started')
    .addFields(
      { name: 'Prompt', value: prompt.slice(0, 1024) },
      { name: 'Interval', value: formatDuration(intervalMs), inline: true },
      { name: 'Loop ID', value: `\`${loopId.slice(0, 20)}\``, inline: true }
    )
    .setFooter({ text: 'Use /stop-loop to cancel' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  const channel = message.channel as TextChannel;

  // Run the prompt immediately for the first iteration
  const runIteration = async () => {
    const loop = activeLoops.get(channelId);
    if (!loop) return;

    loop.iteration++;

    // Create a synthetic-looking message to trigger runClaude
    // We send a new message in the channel so runClaude can create a thread from it
    try {
      const iterMsg = await channel.send(`🔁 **Loop iteration #${loop.iteration}** — \`${prompt.slice(0, 80)}\``);
      await runClaude(prompt, project.workingDirectory, project.name, iterMsg, project.sessionId);
    } catch (err) {
      console.error(`[loop] Iteration ${loop.iteration} failed:`, err);
    }
  };

  const timer = setInterval(runIteration, intervalMs);

  const loop: ActiveLoop = {
    id: loopId,
    prompt,
    intervalMs,
    project,
    channelId,
    startedBy: message.author.id,
    startedAt: Date.now(),
    timer,
    iteration: 0,
  };

  activeLoops.set(channelId, loop);

  // Run first iteration immediately
  await runIteration();
}

/**
 * Stop a loop running in a channel.
 */
export async function stopLoop(channelId: string, message: Message): Promise<void> {
  const loop = activeLoops.get(channelId);
  if (!loop) {
    await message.reply('No loop is running in this channel.');
    return;
  }

  clearInterval(loop.timer);
  activeLoops.delete(channelId);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⏹️ Loop stopped')
    .addFields(
      { name: 'Prompt', value: loop.prompt.slice(0, 1024) },
      { name: 'Iterations', value: String(loop.iteration), inline: true },
      { name: 'Ran for', value: formatDuration(Date.now() - loop.startedAt), inline: true }
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

/**
 * Get info about a loop running in a channel.
 */
export function getLoop(channelId: string): ActiveLoop | undefined {
  return activeLoops.get(channelId);
}

/**
 * Stop all loops (for shutdown).
 */
export function stopAllLoops(): void {
  for (const loop of activeLoops.values()) {
    clearInterval(loop.timer);
  }
  activeLoops.clear();
}

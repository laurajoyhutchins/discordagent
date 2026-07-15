import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { config } from '../config.js';
import { redactErrorMessage } from '../utils/redaction.js';

// ── Types matching SDK's SDKRateLimitInfo ────────────────────────────────

export interface RateLimitSnapshot {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  rateLimitType?: string; // 'five_hour' | 'seven_day' | 'seven_day_opus' | etc.
  utilization?: number;   // 0–1 percentage
  resetsAt?: number;      // Unix timestamp
  overageStatus?: string;
  overageResetsAt?: number;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
  capturedAt: number;     // When we captured this
}

export interface SessionUsage {
  projectName: string;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  completedAt: number;
}

// ── State ────────────────────────────────────────────────────────────────

// Latest rate limit snapshot per type (five_hour, seven_day, etc.)
const rateLimits = new Map<string, RateLimitSnapshot>();

// Rolling usage history (last 50 sessions)
const sessionHistory: SessionUsage[] = [];
const MAX_HISTORY = 50;

let discordClient: Client | null = null;

export function initUsageTracker(client: Client): void {
  discordClient = client;
}

// ── Capture rate limit events from SDK ───────────────────────────────────

export function captureRateLimitEvent(rateLimitInfo: Record<string, unknown>): void {
  const snapshot: RateLimitSnapshot = {
    status: (rateLimitInfo.status as RateLimitSnapshot['status']) ?? 'allowed',
    rateLimitType: rateLimitInfo.rateLimitType as string | undefined,
    utilization: rateLimitInfo.utilization as number | undefined,
    resetsAt: rateLimitInfo.resetsAt as number | undefined,
    overageStatus: rateLimitInfo.overageStatus as string | undefined,
    overageResetsAt: rateLimitInfo.overageResetsAt as number | undefined,
    isUsingOverage: rateLimitInfo.isUsingOverage as boolean | undefined,
    surpassedThreshold: rateLimitInfo.surpassedThreshold as number | undefined,
    capturedAt: Date.now(),
  };

  const key = snapshot.rateLimitType ?? 'unknown';
  rateLimits.set(key, snapshot);

  // Log warnings
  if (snapshot.status === 'allowed_warning') {
    console.warn(`[usage] ⚠️ Rate limit warning: ${key} at ${((snapshot.utilization ?? 0) * 100).toFixed(0)}%`);
  } else if (snapshot.status === 'rejected') {
    console.error(`[usage] 🛑 Rate limit REJECTED: ${key}`);
  }
}

// ── Capture session completion data ──────────────────────────────────────

export async function captureSessionResult(
  projectName: string,
  result: Record<string, unknown>
): Promise<void> {
  const usage = (result.usage as Record<string, number>) ?? {};
  const entry: SessionUsage = {
    projectName,
    costUsd: (result.total_cost_usd as number) ?? 0,
    durationMs: (result.duration_ms as number) ?? 0,
    inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
    cacheReadTokens: usage.cacheReadInputTokens ?? usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens ?? 0,
    numTurns: (result.num_turns as number) ?? 0,
    completedAt: Date.now(),
  };

  sessionHistory.push(entry);
  if (sessionHistory.length > MAX_HISTORY) sessionHistory.shift();

  // Post to usage channel if configured
  if (config.usageChannelId && discordClient) {
    await postUsageUpdate(entry).catch(err => {
      console.error('[usage] Failed to post usage update:', redactErrorMessage(err));
    });
  }
}

// ── Public getters ───────────────────────────────────────────────────────

export function getLatestRateLimits(): Map<string, RateLimitSnapshot> {
  return new Map(rateLimits);
}

export function getSessionHistory(): SessionUsage[] {
  return [...sessionHistory];
}

export function getTotalCostToday(): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return sessionHistory
    .filter(s => s.completedAt >= startOfDay.getTime())
    .reduce((sum, s) => sum + s.costUsd, 0);
}

// ── Discord embed builders ───────────────────────────────────────────────

export function buildUsageEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 Claude Code Usage')
    .setTimestamp();

  // Rate limits section
  if (rateLimits.size === 0) {
    embed.setDescription('No rate limit data yet — usage info appears after the first query.');
    return embed;
  }

  for (const [type, snap] of rateLimits) {
    const statusIcon = snap.status === 'rejected' ? '🛑'
      : snap.status === 'allowed_warning' ? '⚠️'
      : '✅';
    const statusText = snap.status === 'rejected' ? 'Rate Limited'
      : snap.status === 'allowed_warning' ? 'Approaching Limit'
      : 'OK';

    const lines: string[] = [`**Status:** ${statusText}`];

    if (snap.utilization != null) {
      const pct = (snap.utilization * 100).toFixed(1);
      const bar = progressBar(snap.utilization);
      lines.push(`${bar} **${pct}%**`);
    }

    if (snap.resetsAt) {
      const diffMs = snap.resetsAt * 1000 - Date.now();
      if (diffMs > 0) {
        lines.push(`**Resets in:** ${formatDuration(diffMs)}`);
      } else {
        lines.push('**Reset:** now');
      }
    }

    const label = formatLimitType(type);
    embed.addFields({
      name: `${statusIcon} ${label}`,
      value: lines.join('\n'),
      inline: true,
    });
  }

  // Overage info
  const anyOverage = [...rateLimits.values()].find(s => s.isUsingOverage);
  if (anyOverage) {
    embed.addFields({
      name: '💰 Overage',
      value: 'Currently using overage budget',
      inline: false,
    });
  }

  // Today's session stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySessions = sessionHistory.filter(s => s.completedAt >= todayStart.getTime());
  const todayCost = todaySessions.reduce((sum, s) => sum + s.costUsd, 0);
  const todayTokens = todaySessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0);

  if (todaySessions.length > 0) {
    embed.addFields({
      name: '📈 Today',
      value: [
        `**Sessions:** ${todaySessions.length}`,
        `**Est. Cost:** ~$${todayCost.toFixed(4)}`,
        `**Tokens:** ${formatNumber(todayTokens)}`,
      ].join('\n'),
      inline: false,
    });
  }

  // Data freshness
  const latestCapture = Math.max(...[...rateLimits.values()].map(s => s.capturedAt));
  const ago = Date.now() - latestCapture;
  embed.setFooter({ text: `Last updated ${formatDuration(ago)} ago` });

  return embed;
}

// ── Post usage update to the configured channel ──────────────────────────

async function postUsageUpdate(session: SessionUsage): Promise<void> {
  if (!config.usageChannelId || !discordClient) return;

  const channel = await discordClient.channels.fetch(config.usageChannelId).catch(() => null);
  if (!channel || !('send' in channel)) return;

  const textChannel = channel as TextChannel;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔄 Session Complete')
    .setTimestamp()
    .addFields(
      { name: 'Project', value: session.projectName, inline: true },
      { name: 'Est. Cost', value: `~$${session.costUsd.toFixed(4)}`, inline: true },
      { name: 'Duration', value: formatDuration(session.durationMs), inline: true },
    );

  if (session.numTurns > 0) {
    embed.addFields({ name: 'Turns', value: String(session.numTurns), inline: true });
  }

  const totalTokens = session.inputTokens + session.outputTokens;
  if (totalTokens > 0) {
    embed.addFields({
      name: 'Tokens',
      value: `In: ${formatNumber(session.inputTokens)} / Out: ${formatNumber(session.outputTokens)}`,
      inline: true,
    });
  }

  // Include latest rate limit info if available
  for (const [type, snap] of rateLimits) {
    const statusIcon = snap.status === 'rejected' ? '🛑'
      : snap.status === 'allowed_warning' ? '⚠️'
      : '✅';
    const statusText = snap.status === 'rejected' ? 'Limited'
      : snap.status === 'allowed_warning' ? 'Warning'
      : 'OK';
    const label = formatLimitType(type);
    let value = `${statusIcon} ${statusText}`;
    if (snap.utilization != null) {
      value += ` (${(snap.utilization * 100).toFixed(1)}%)`;
    }
    if (snap.resetsAt) {
      const diffMs = snap.resetsAt * 1000 - Date.now();
      if (diffMs > 0) value += ` · resets ${formatDuration(diffMs)}`;
    }
    embed.addFields({ name: label, value, inline: true });
  }

  await textChannel.send({ embeds: [embed] });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function progressBar(ratio: number): string {
  const filled = Math.round(ratio * 10);
  const empty = 10 - filled;
  const filledChar = ratio > 0.9 ? '🟥' : ratio > 0.7 ? '🟧' : '🟩';
  return filledChar.repeat(filled) + '⬜'.repeat(empty);
}

function formatLimitType(type: string): string {
  switch (type) {
    case 'five_hour': return '5-Hour Window';
    case 'seven_day': return 'Weekly Limit';
    case 'seven_day_opus': return 'Weekly (Opus)';
    case 'seven_day_sonnet': return 'Weekly (Sonnet)';
    case 'overage': return 'Overage';
    default: return type;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

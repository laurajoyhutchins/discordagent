import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EmbedBuilder } from 'discord.js';
import type { ReviewNotification } from '../reviewSource.js';
import type { VerdictConfig } from './types.js';

const VERDICT_CONFIG: Record<string, VerdictConfig> = {
  A: { color: 0x2ecc71, label: 'Approved', emoji: '✅' },
  B: { color: 0x3498db, label: 'Minor Issues', emoji: '💡' },
  C: { color: 0xf39c12, label: 'Needs Changes', emoji: '⚠️' },
  D: { color: 0xe67e22, label: 'Significant Issues', emoji: '🔶' },
  F: { color: 0xe74c3c, label: 'Critical Issues', emoji: '❌' },
};

export function buildReviewEmbed(
  notification: ReviewNotification,
): EmbedBuilder {
  if (notification.status === 'started') {
    return buildStartedEmbed(notification);
  }
  return buildCompletedEmbed(notification);
}

function buildStartedEmbed(notification: ReviewNotification): EmbedBuilder {
  const sha = notification.revision?.slice(0, 8) ?? 'unknown';
  const agent = (notification.details?.agent as string) ?? 'unknown';
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle(`🔍 Reviewing ${sha}`)
    .setDescription(`Agent: **${agent}**`)
    .setTimestamp(
      notification.details?.timestamp
        ? new Date(notification.details.timestamp as string)
        : undefined,
    );
}

function buildCompletedEmbed(notification: ReviewNotification): EmbedBuilder {
  const verdict = (notification.details?.verdict as string) ?? '';
  const config = VERDICT_CONFIG[verdict]
    ?? { color: 0x95a5a6, label: 'Unknown', emoji: '❓' };
  const sha = notification.revision?.slice(0, 8) ?? 'unknown';
  const agent = (notification.details?.agent as string) ?? 'unknown';
  const jobId = notification.details?.jobId as number | undefined;
  const body = notification.details?.body as string | undefined;

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(`${config.emoji} Review: ${sha} — ${config.label}`)
    .setTimestamp(
      notification.details?.timestamp
        ? new Date(notification.details.timestamp as string)
        : undefined,
    );

  if (body) {
    embed.setDescription(
      body.length > 4000
        ? `${body.slice(0, 4000)}\n...(truncated)`
        : body,
    );
  } else {
    embed.setDescription(
      `Verdict: **${config.label}** (${verdict || 'unknown'})\n`
      + (jobId ? `Run \`roborev show ${jobId}\` for details.` : ''),
    );
  }

  embed.addFields(
    { name: 'Commit', value: `\`${sha}\``, inline: true },
    { name: 'Agent', value: agent, inline: true },
    { name: 'Verdict', value: `${config.emoji} ${verdict || '?'}`, inline: true },
  );

  return embed;
}

export function anyProjectHasRoborev(
  projects: ReadonlyArray<{ roborevChannelId?: string }>,
): boolean {
  return projects.some(p => Boolean(p.roborevChannelId));
}

export function hasRoborevSetup(
  projectPath: string,
  deps?: { existsSync: typeof existsSync; join: typeof join },
): boolean {
  const fs = deps ?? { existsSync, join };
  return (
    fs.existsSync(fs.join(projectPath, '.roborev'))
    || fs.existsSync(fs.join(projectPath, '.roborev.json'))
    || fs.existsSync(fs.join(projectPath, '.git', 'hooks', 'post-commit'))
  );
}

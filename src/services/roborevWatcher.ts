import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import { config } from '../config.js';
import { getAllProjects } from './projectStore.js';
import type { Project } from '../types.js';
import { redactErrorMessage, redactSensitiveText } from '../utils/redaction.js';

const execFileAsync = promisify(execFile);
let roborevProcess: ChildProcess | null = null;
let discordClient: Client | null = null;
let backoffMs = 1000;
let consecutiveFailures = 0;
const MAX_BACKOFF = 60_000;
const MAX_FAILURES = 10;

export interface RoborevStreamEvent {
  type: string;
  ts: string;
  job_id: number;
  repo: string;
  repo_name: string;
  sha: string;
  agent: string;
  verdict?: string;
}

export interface RoborevRoutingDependencies {
  client: Client;
  getProjects(): Project[];
  getReviewBody(jobId: number): Promise<string>;
}

export function initRoborevWatcher(client: Client): void {
  discordClient = client;
}

function matchProject(repoPath: string, projects: Project[]): Project | undefined {
  const repo = repoPath.toLowerCase().replace(/\/+$/, '');
  return projects.find(project => {
    if (!project.roborevChannelId) return false;
    const directory = project.workingDirectory.toLowerCase().replace(/\/+$/, '');
    return repo === directory || repo.startsWith(`${directory}/`);
  });
}

async function fetchReviewBody(jobId: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(config.roborevCliPath, ['show', String(jobId)], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, CLAUDECODE: '' },
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function isRoborevCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync(config.roborevCliPath, ['version'], {
      timeout: 5000,
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

const VERDICT_CONFIG: Record<string, { color: number; label: string; emoji: string }> = {
  A: { color: 0x2ecc71, label: 'Approved', emoji: '✅' },
  B: { color: 0x3498db, label: 'Minor Issues', emoji: '💡' },
  C: { color: 0xf39c12, label: 'Needs Changes', emoji: '⚠️' },
  D: { color: 0xe67e22, label: 'Significant Issues', emoji: '🔶' },
  F: { color: 0xe74c3c, label: 'Critical Issues', emoji: '❌' },
};

async function sendEmbed(client: Client, channelId: string, embed: EmbedBuilder): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !('send' in channel)) return;
  await (channel as TextChannel).send({ embeds: [embed] });
}

export async function handleRoborevEvent(
  event: RoborevStreamEvent,
  injected?: RoborevRoutingDependencies,
): Promise<void> {
  const dependencies = injected ?? (discordClient
    ? { client: discordClient, getProjects: getAllProjects, getReviewBody: fetchReviewBody }
    : null);
  if (!dependencies) {
    console.warn('[roborev] Discord client is not initialized; event skipped.');
    return;
  }

  const project = matchProject(event.repo, dependencies.getProjects());
  if (!project?.roborevChannelId) return;

  if (event.type === 'review.started') {
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🔍 Reviewing ${event.sha.slice(0, 8)}`)
      .setDescription(`Agent: **${event.agent}**`)
      .setTimestamp(new Date(event.ts));
    await sendEmbed(dependencies.client, project.roborevChannelId, embed).catch(error => {
      console.error('[roborev] Failed to send started embed:', redactErrorMessage(error));
    });
    return;
  }

  if (event.type === 'review.completed') {
    const verdict = VERDICT_CONFIG[event.verdict ?? '']
      ?? { color: 0x95a5a6, label: 'Unknown', emoji: '❓' };
    const reviewBody = await dependencies.getReviewBody(event.job_id);
    const embed = new EmbedBuilder()
      .setColor(verdict.color)
      .setTitle(`${verdict.emoji} Review: ${event.sha.slice(0, 8)} — ${verdict.label}`)
      .setTimestamp(new Date(event.ts));

    if (reviewBody) {
      embed.setDescription(reviewBody.length > 4000
        ? `${reviewBody.slice(0, 4000)}\n...(truncated)`
        : reviewBody);
    } else {
      embed.setDescription(
        `Verdict: **${verdict.label}** (${event.verdict ?? 'unknown'})\n` +
        `Run \`roborev show ${event.job_id}\` for details.`,
      );
    }
    embed.addFields(
      { name: 'Commit', value: `\`${event.sha.slice(0, 8)}\``, inline: true },
      { name: 'Agent', value: event.agent, inline: true },
      { name: 'Verdict', value: `${verdict.emoji} ${event.verdict ?? '?'}`, inline: true },
    );
    await sendEmbed(dependencies.client, project.roborevChannelId, embed).catch(error => {
      console.error('[roborev] Failed to send completed embed:', redactErrorMessage(error));
    });
    return;
  }

  console.log(`[roborev] Unhandled event type: ${event.type}`);
}

export function anyProjectHasRoborev(
  getProjects: () => Project[] = getAllProjects,
): boolean {
  return getProjects().some(project => Boolean(project.roborevChannelId));
}

export async function startRoborevWatcher(): Promise<void> {
  if (!anyProjectHasRoborev()) {
    console.log('[roborev] No projects with roborev enabled, skipping watcher.');
    return;
  }
  if (!discordClient) {
    console.warn('[roborev] Discord client is not initialized. Watcher disabled.');
    return;
  }
  if (!await isRoborevCliAvailable()) {
    console.warn(
      `[roborev] CLI not found at "${config.roborevCliPath}". ` +
      'Watcher disabled. Install roborev or set ROBOREV_CLI_PATH.',
    );
    return;
  }

  if (roborevProcess) {
    roborevProcess.removeAllListeners('close');
    roborevProcess.kill('SIGTERM');
  }

  console.log('[roborev] Starting watcher...');
  roborevProcess = spawn(config.roborevCliPath, ['stream'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, CLAUDECODE: '' },
  });

  let lineBuffer = '';
  roborevProcess.stdout!.on('data', (data: Buffer) => {
    lineBuffer += data.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as RoborevStreamEvent;
        console.log(`[roborev] Event: ${event.type} job=${event.job_id} repo=${event.repo_name}`);
        void handleRoborevEvent(event).catch(error => {
          console.error('[roborev] Error handling event:', redactErrorMessage(error));
        });
      } catch {
        console.error('[roborev] Non-JSON line:', redactSensitiveText(line));
      }
    }
  });
  roborevProcess.stderr!.on('data', (data: Buffer) => {
    console.error('[roborev stderr]', redactSensitiveText(data.toString()));
  });

  const stabilityTimer = setTimeout(() => {
    if (roborevProcess) {
      backoffMs = 1000;
      consecutiveFailures = 0;
    }
  }, 5000);

  roborevProcess.on('close', code => {
    clearTimeout(stabilityTimer);
    roborevProcess = null;
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(`[roborev] Process failed ${consecutiveFailures} times. Restart the bot to retry.`);
      return;
    }
    console.log(
      `[roborev] Process exited with code ${code}. Restarting in ${backoffMs}ms ` +
      `(attempt ${consecutiveFailures}/${MAX_FAILURES})`,
    );
    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      void startRoborevWatcher().catch(error => console.error('[roborev] Retry failed:', redactErrorMessage(error)));
    }, backoffMs);
  });

  roborevProcess.on('error', error => {
    clearTimeout(stabilityTimer);
    console.error('[roborev] Failed to spawn:', redactErrorMessage(error));
    roborevProcess = null;
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(`[roborev] Spawn failed ${consecutiveFailures} times. Restart the bot to retry.`);
      return;
    }
    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      void startRoborevWatcher().catch(retryError => {
        console.error('[roborev] Retry failed:', redactErrorMessage(retryError));
      });
    }, backoffMs);
  });
}

export function stopRoborevWatcher(): void {
  if (roborevProcess) {
    roborevProcess.kill('SIGTERM');
    roborevProcess = null;
  }
}

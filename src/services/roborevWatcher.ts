import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { WebhookClient, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { getAllProjects } from './projectStore.js';
import type { Project } from '../types.js';

let roborevProcess: ChildProcess | null = null;
let backoffMs = 1000;
let consecutiveFailures = 0;
const MAX_BACKOFF = 60000;
const MAX_FAILURES = 10; // Stop retrying after this many consecutive failures

const webhookClients = new Map<string, WebhookClient>();

interface StreamEvent {
  type: string;
  ts: string;
  job_id: number;
  repo: string;
  repo_name: string;
  sha: string;
  agent: string;
  verdict?: string;
}

function getWebhookClient(project: Project): WebhookClient | null {
  if (!project.roborevWebhookId || !project.roborevWebhookToken) return null;
  const key = project.roborevWebhookId;
  if (!webhookClients.has(key)) {
    webhookClients.set(
      key,
      new WebhookClient({ id: project.roborevWebhookId, token: project.roborevWebhookToken })
    );
  }
  return webhookClients.get(key)!;
}

function matchProject(repoPath: string): Project | undefined {
  const projects = getAllProjects();
  return projects.find(p => p.roborevWebhookId && repoPath.startsWith(p.workingDirectory));
}

async function getReviewBody(jobId: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(config.roborevCliPath, ['show', String(jobId)], {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, CLAUDECODE: '' },
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Check if the roborev CLI is actually available on the system.
 */
async function isRoborevCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync(config.roborevCliPath, ['--version'], {
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

async function handleEvent(event: StreamEvent): Promise<void> {
  if (event.type === 'review.started') {
    const project = matchProject(event.repo);
    if (!project) return;

    const webhook = getWebhookClient(project);
    if (!webhook) return;
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🔍 Reviewing ${event.sha.slice(0, 8)}`)
      .setDescription(`Agent: **${event.agent}**`)
      .setTimestamp(new Date(event.ts));

    try {
      await webhook.send({ embeds: [embed] });
    } catch (err) {
      console.error(`[roborev] Failed to send started embed:`, err);
    }
    return;
  }

  if (event.type === 'review.completed') {
    const project = matchProject(event.repo);
    if (!project) return;

    const webhook = getWebhookClient(project);
    if (!webhook) return;
    const verdictInfo = VERDICT_CONFIG[event.verdict ?? ''] ?? { color: 0x95a5a6, label: 'Unknown', emoji: '❓' };

    const reviewBody = await getReviewBody(event.job_id);

    const embed = new EmbedBuilder()
      .setColor(verdictInfo.color)
      .setTitle(`${verdictInfo.emoji} Review: ${event.sha.slice(0, 8)} — ${verdictInfo.label}`)
      .setTimestamp(new Date(event.ts));

    if (reviewBody) {
      const body = reviewBody.length > 4000 ? reviewBody.slice(0, 4000) + '\n...(truncated)' : reviewBody;
      embed.setDescription(body);
    } else {
      embed.setDescription(`Verdict: **${verdictInfo.label}** (${event.verdict})\nRun \`roborev show ${event.job_id}\` for details.`);
    }

    embed.addFields(
      { name: 'Commit', value: `\`${event.sha.slice(0, 8)}\``, inline: true },
      { name: 'Agent', value: event.agent, inline: true },
      { name: 'Verdict', value: `${verdictInfo.emoji} ${event.verdict}`, inline: true }
    );

    try {
      await webhook.send({ embeds: [embed] });
    } catch (err) {
      console.error(`[roborev] Failed to send completed embed:`, err);
    }
    return;
  }

  console.log(`[roborev] Unhandled event type: ${event.type}`);
}

/**
 * Check if any registered projects have roborev enabled.
 */
export function anyProjectHasRoborev(): boolean {
  return getAllProjects().some(p => !!p.roborevWebhookId);
}

export async function startRoborevWatcher(): Promise<void> {
  // Only start if at least one project has roborev enabled
  if (!anyProjectHasRoborev()) {
    console.log('[roborev] No projects with roborev enabled, skipping watcher.');
    return;
  }

  // Check if the CLI is actually available before spawning
  const cliAvailable = await isRoborevCliAvailable();
  if (!cliAvailable) {
    console.warn(`[roborev] CLI not found at "${config.roborevCliPath}". Watcher disabled. Install roborev or set ROBOREV_CLI_PATH.`);
    return;
  }

  if (roborevProcess) {
    roborevProcess.removeAllListeners('close');
    roborevProcess.kill('SIGTERM');
    roborevProcess = null;
  }

  console.log('[roborev] Starting watcher...');

  roborevProcess = spawn(config.roborevCliPath, ['stream'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, CLAUDECODE: '' },
  });

  let lineBuf = '';

  roborevProcess.stdout!.on('data', (data: Buffer) => {
    lineBuf += data.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as StreamEvent;
        console.log(`[roborev] Event: ${event.type} job=${event.job_id} repo=${event.repo_name}`);
        handleEvent(event).catch(err =>
          console.error('[roborev] Error handling event:', err)
        );
      } catch {
        console.error('[roborev] Non-JSON line:', line);
      }
    }
  });

  roborevProcess.stderr!.on('data', (data: Buffer) => {
    console.error('[roborev stderr]', data.toString());
  });

  // Reset backoff and failure count if the process stays alive for 5 seconds.
  // Store the timer so we can cancel it if the process exits early.
  const stabilityTimer = setTimeout(() => {
    if (roborevProcess) {
      backoffMs = 1000;
      consecutiveFailures = 0;
    }
  }, 5000);

  roborevProcess.on('close', (code) => {
    clearTimeout(stabilityTimer);
    roborevProcess = null;
    consecutiveFailures++;

    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(`[roborev] Process failed ${consecutiveFailures} times. Giving up. Restart the bot to retry.`);
      return;
    }

    console.log(`[roborev] Process exited with code ${code}. Restarting in ${backoffMs}ms... (attempt ${consecutiveFailures}/${MAX_FAILURES})`);

    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      startRoborevWatcher().catch(err => {
        console.error('[roborev] Retry failed:', err);
      });
    }, backoffMs);
  });

  roborevProcess.on('error', (err) => {
    clearTimeout(stabilityTimer);
    console.error('[roborev] Failed to spawn:', err.message);
    roborevProcess = null;
    consecutiveFailures++;

    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(`[roborev] Spawn failed ${consecutiveFailures} times. Giving up. Restart the bot to retry.`);
      return;
    }

    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      startRoborevWatcher().catch(err2 => {
        console.error('[roborev] Retry failed:', err2);
      });
    }, backoffMs);
  });
}

export function stopRoborevWatcher(): void {
  if (roborevProcess) {
    roborevProcess.kill('SIGTERM');
    roborevProcess = null;
  }
  for (const client of webhookClients.values()) {
    client.destroy();
  }
  webhookClients.clear();
}

import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { WebhookClient, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { getAllProjects } from './projectStore.js';
import type { Project } from '../types.js';

let roborevProcess: ChildProcess | null = null;
let backoffMs = 1000;
const MAX_BACKOFF = 60000;

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

function getWebhookClient(project: Project): WebhookClient {
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
  return projects.find(p => repoPath.startsWith(p.workingDirectory));
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
    const verdictInfo = VERDICT_CONFIG[event.verdict ?? ''] ?? { color: 0x95a5a6, label: 'Unknown', emoji: '❓' };

    // Fetch full review body
    const reviewBody = await getReviewBody(event.job_id);

    const embed = new EmbedBuilder()
      .setColor(verdictInfo.color)
      .setTitle(`${verdictInfo.emoji} Review: ${event.sha.slice(0, 8)} — ${verdictInfo.label}`)
      .setTimestamp(new Date(event.ts));

    if (reviewBody) {
      // Truncate to Discord embed limit (4096 chars)
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

export function startRoborevWatcher(): void {
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

  roborevProcess.on('close', (code) => {
    console.log(`[roborev] Process exited with code ${code}. Restarting in ${backoffMs}ms...`);
    roborevProcess = null;

    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      startRoborevWatcher();
    }, backoffMs);
  });

  roborevProcess.on('error', (err) => {
    console.error('[roborev] Failed to spawn:', err.message);
    roborevProcess = null;

    setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      startRoborevWatcher();
    }, backoffMs);
  });

  setTimeout(() => {
    if (roborevProcess) backoffMs = 1000;
  }, 5000);
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

import { spawn, ChildProcess } from 'node:child_process';
import { WebhookClient, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { getAllProjects } from './projectStore.js';
import type { RoborevEvent, Project } from '../types.js';

let roborevProcess: ChildProcess | null = null;
let backoffMs = 1000;
const MAX_BACKOFF = 60000;

const webhookClients = new Map<string, WebhookClient>();

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

const SEVERITY_COLORS: Record<string, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  error: 0xe74c3c,
};

function buildEmbed(event: RoborevEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SEVERITY_COLORS[event.severity ?? 'info'] ?? 0x95a5a6)
    .setTitle(`${(event.severity ?? 'info').toUpperCase()}: ${event.file ?? 'Unknown file'}`)
    .setDescription(event.message ?? 'No message');

  if (event.line) embed.addFields({ name: 'Line', value: String(event.line), inline: true });
  if (event.commit) embed.addFields({ name: 'Commit', value: event.commit.slice(0, 8), inline: true });
  if (event.author) embed.addFields({ name: 'Author', value: event.author, inline: true });
  if (event.suggestion) embed.addFields({ name: 'Suggestion', value: event.suggestion });

  return embed;
}

async function handleEvent(event: RoborevEvent): Promise<void> {
  if (!event.repo) return;

  const project = matchProject(event.repo);
  if (!project) return;

  const webhook = getWebhookClient(project);
  const embed = buildEmbed(event);

  try {
    await webhook.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Failed to send roborev embed for ${project.name}:`, err);
  }
}

export function startRoborevWatcher(): void {
  // Kill any existing process first
  if (roborevProcess) {
    roborevProcess.removeAllListeners('close');
    roborevProcess.kill('SIGTERM');
    roborevProcess = null;
  }

  console.log('[roborev] Starting watcher...');

  roborevProcess = spawn(config.roborevCliPath, ['stream'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let lineBuf = '';

  roborevProcess.stdout!.on('data', (data: Buffer) => {
    lineBuf += data.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as RoborevEvent;
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

  // Reset backoff on successful start
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

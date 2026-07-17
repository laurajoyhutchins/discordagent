import {
  EmbedBuilder,
  type AnyThreadChannel,
  type Message,
} from 'discord.js';
import type { AgentEvent, TaskResult } from '../agents/contracts.js';
import { chunkText } from '../utils/chunker.js';
import { buildErrorEmbed, isStructuredErrorMessage } from './errorCard.js';

const DEFAULT_EDIT_INTERVAL_MS = 1_500;
const MESSAGE_LIMIT = 1_800;

export interface TaskRenderer {
  start(thread: AnyThreadChannel): void;
  handle(event: AgentEvent): Promise<void>;
  finish(result: TaskResult): Promise<void>;
}

export interface DiscordTaskRendererOptions {
  editIntervalMs?: number;
  notifyUserId?: string;
}

export class DiscordTaskRenderer implements TaskRenderer {
  private readonly editIntervalMs: number;
  private readonly notifyUserId: string;
  private thread: AnyThreadChannel | null = null;
  private buffer = '';
  private currentMessage: Message | null = null;
  private editTimer: ReturnType<typeof setInterval> | null = null;
  private finalized = false;
  private dirty = false;
  private flushing = false;

  constructor(options: DiscordTaskRendererOptions = {}) {
    this.editIntervalMs = options.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS;
    this.notifyUserId = options.notifyUserId ?? '';
  }

  start(thread: AnyThreadChannel): void {
    if (this.thread) throw new Error('Task renderer has already been started');
    this.thread = thread;
    if (this.editIntervalMs > 0) {
      this.editTimer = setInterval(() => {
        void this.flush();
      }, this.editIntervalMs);
    }
  }

  async handle(event: AgentEvent): Promise<void> {
    this.requireThread();

    switch (event.type) {
      case 'session_started':
      case 'approval_request':
      case 'user_question':
      case 'usage':
      case 'completed':
      case 'failed':
        return;
      case 'text_delta':
        await this.append(event.text);
        return;
      case 'status':
        await this.sendEmbed(
          new EmbedBuilder()
            .setTitle('ℹ️ Status')
            .setDescription(truncate([`**${event.phase}**`, event.detail].filter(Boolean).join('\n'), 4_000))
            .setTimestamp(),
        );
        return;
      case 'plan': {
        const icons = {
          pending: '○',
          in_progress: '◐',
          completed: '●',
          blocked: '⊘',
        } as const;
        const description = event.items
          .map(item => `${icons[item.status]} ${item.text}`)
          .join('\n') || 'No plan items.';
        await this.sendEmbed(
          new EmbedBuilder()
            .setTitle('📋 Plan')
            .setDescription(description.slice(0, 4_000))
            .setTimestamp(),
        );
        return;
      }
      case 'command': {
        const embed = new EmbedBuilder()
          .setTitle('⌨️ Command')
          .setDescription(`\`\`\`sh\n${truncate(event.command, 3_700)}\n\`\`\``)
          .addFields({ name: 'State', value: event.state, inline: true })
          .setTimestamp();
        if (event.output) {
          embed.addFields({ name: 'Output', value: `\`\`\`\n${truncate(event.output, 900)}\n\`\`\`` });
        }
        await this.sendEmbed(embed);
        return;
      }
      case 'file_change': {
        const paths = event.paths.length > 0
          ? event.paths.map(path => `- \`${truncate(path, 240)}\``).join('\n')
          : 'No paths reported.';
        const description = [event.summary, paths].filter(Boolean).join('\n\n');
        await this.sendEmbed(
          new EmbedBuilder()
            .setTitle('📝 File changes')
            .setDescription(truncate(description, 4_000))
            .setTimestamp(),
        );
        return;
      }
    }
  }

  async finish(result: TaskResult): Promise<void> {
    const thread = this.requireThread();
    this.finalized = true;
    if (this.editTimer) {
      clearInterval(this.editTimer);
      this.editTimer = null;
    }

    while (this.flushing) {
      await delay(5);
    }
    await this.flushFinalText();

    const presentation = terminalPresentation(result);
    const errorText = result.error?.message ?? result.summary;
    const structuredError = result.outcome === 'failed' && Boolean(errorText && isStructuredErrorMessage(errorText));
    const embed = structuredError
      ? buildErrorEmbed(errorText, 'Task failed')
      : new EmbedBuilder()
        .setTitle(presentation.title)
        .setTimestamp(new Date(result.completedAt));

    if (result.summary && !structuredError) embed.setDescription(truncate(result.summary, 4_000));
    if (result.branchName) {
      embed.addFields({ name: 'Branch', value: `\`${truncate(result.branchName, 900)}\``, inline: false });
    }
    if (result.verification?.length) {
      embed.addFields({
        name: 'Verification',
        value: result.verification.map(item => `- ${item}`).join('\n').slice(0, 1_024),
        inline: false,
      });
    }
    if (result.unresolved?.length) {
      embed.addFields({
        name: 'Needs decision',
        value: result.unresolved.map(item => `- ${item}`).join('\n').slice(0, 1_024),
        inline: false,
      });
    }
    if (result.error && !result.summary && !structuredError) {
      embed.setDescription(truncate(result.error.message, 4_000));
    }

    const content = this.notifyUserId ? `<@${this.notifyUserId}>` : undefined;
    await thread.send({ content, embeds: [embed] }).catch(() => undefined);
  }

  private async append(text: string): Promise<void> {
    if (this.finalized || text.length === 0) return;
    this.buffer += text;
    this.dirty = true;

    if (this.buffer.length > MESSAGE_LIMIT && this.currentMessage) {
      await this.finalizeCurrentMessage();
    }
    if (this.editIntervalMs === 0) await this.flush();
  }

  private async flush(): Promise<void> {
    const thread = this.requireThread();
    if (this.flushing || this.finalized || !this.dirty || this.buffer.length === 0) return;
    this.flushing = true;
    this.dirty = false;
    const display = this.buffer.slice(0, MESSAGE_LIMIT);

    try {
      const content = `${wrapCodeBlock(display)} ▍`;
      if (!this.currentMessage) {
        this.currentMessage = await thread.send(content);
      } else {
        await this.currentMessage.edit(content);
      }
    } catch {
      this.dirty = true;
    } finally {
      this.flushing = false;
    }
  }

  private async finalizeCurrentMessage(): Promise<void> {
    if (!this.currentMessage) return;
    const text = this.buffer.slice(0, MESSAGE_LIMIT);
    this.buffer = this.buffer.slice(MESSAGE_LIMIT);
    this.dirty = this.buffer.length > 0;
    await this.currentMessage.edit(wrapCodeBlock(text)).catch(() => undefined);
    this.currentMessage = null;
  }

  private async flushFinalText(): Promise<void> {
    const thread = this.requireThread();
    if (this.buffer.length === 0) {
      if (this.currentMessage) {
        const content = this.currentMessage.content.replace(/ ▍$/, '');
        await this.currentMessage.edit(content).catch(() => undefined);
      }
      return;
    }

    const chunks = chunkText(this.buffer);
    for (const chunk of chunks) {
      if (this.currentMessage) {
        await this.currentMessage.edit(wrapCodeBlock(chunk)).catch(() => undefined);
        this.currentMessage = null;
      } else {
        await thread.send(wrapCodeBlock(chunk)).catch(() => undefined);
      }
    }
    this.buffer = '';
    this.dirty = false;
  }

  private async sendEmbed(embed: EmbedBuilder): Promise<void> {
    await this.requireThread().send({ embeds: [embed] }).catch(() => undefined);
  }

  private requireThread(): AnyThreadChannel {
    if (!this.thread) throw new Error('Task renderer must be started before use');
    return this.thread;
  }
}

function terminalPresentation(result: TaskResult): { title: string } {
  switch (result.outcome) {
    case 'completed': return { title: '✅ Task complete' };
    case 'failed': return { title: '❌ Task failed' };
    case 'cancelled': return { title: '🛑 Task cancelled' };
    case 'interrupted': return { title: '⏸️ Task paused' };
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function wrapCodeBlock(text: string): string {
  return `\`\`\`\n${text.replace(/\`\`\`/g, '\`\u200b\`\`')}\n\`\`\``;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

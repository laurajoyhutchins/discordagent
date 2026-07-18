import {
  EmbedBuilder,
  type AnyThreadChannel,
  type Message,
} from 'discord.js';
import type { AgentEvent, TaskResult } from '../agents/contracts.js';
import type { TaskRecord, WorktreeRecord } from '../types.js';
import { chunkText } from '../utils/chunker.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { buildErrorEmbed, isStructuredErrorMessage } from './errorCard.js';
import { renderTaskControlCard, type TaskControlCardMessage, type TaskControlCardStore, type TaskControlCardView } from './taskControlCard.js';

const DEFAULT_EDIT_INTERVAL_MS = 1_500;
const MESSAGE_LIMIT = 1_800;
const DISCORD_MESSAGE_LIMIT = 2_000;

export interface TaskRenderer {
  start(thread: AnyThreadChannel, context?: TaskRenderContext): void | Promise<void>;
  updateCard?(context: TaskRenderContext): Promise<void>;
  handle(event: AgentEvent): Promise<void>;
  finish(result: TaskResult): Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface TaskRenderContext {
  readonly task: TaskRecord;
  readonly worktree?: WorktreeRecord;
  readonly result?: TaskResult;
  readonly phase?: string;
  readonly usagePosture?: string;
}

export interface DiscordTaskRendererOptions {
  editIntervalMs?: number;
  notifyUserId?: string;
  controlCardStore?: TaskControlCardStore;
  controlCardCanEmbed?: (thread: AnyThreadChannel) => boolean;
  controlCardCanPin?: (thread: AnyThreadChannel) => boolean;
  logger?: (message: string) => void;
}

export class DiscordTaskRenderer implements TaskRenderer {
  private readonly editIntervalMs: number;
  private readonly notifyUserId: string;
  private thread: AnyThreadChannel | null = null;
  private buffer = '';
  private currentMessage: Message | null = null;
  private editTimer: ReturnType<typeof setInterval> | null = null;
  private finalized = false;
  private disposed = false;
  private dirty = false;
  private flushing = false;
  private readonly controlCardStore?: TaskControlCardStore;
  private readonly controlCardCanEmbed: (thread: AnyThreadChannel) => boolean;
  private readonly controlCardCanPin: (thread: AnyThreadChannel) => boolean;
  private readonly logger: (message: string) => void;
  private controlCardMessage: TaskControlCardMessage | null = null;
  private controlCardTaskId: string | null = null;
  private controlCardPinAttempted = false;
  private controlCardEmbedsDisabled = false;
  private latestCardContext: TaskRenderContext | null = null;
  private cardQueue: Promise<void> = Promise.resolve();
  private cardUpdateScheduled = false;

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.editTimer) {
      clearInterval(this.editTimer);
      this.editTimer = null;
    }
    await this.cardQueue.catch(() => undefined);
  }

  constructor(options: DiscordTaskRendererOptions = {}) {
    this.editIntervalMs = options.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS;
    this.notifyUserId = options.notifyUserId ?? '';
    this.controlCardStore = options.controlCardStore;
    this.controlCardCanEmbed = options.controlCardCanEmbed ?? (() => true);
    this.controlCardCanPin = options.controlCardCanPin ?? (() => false);
    this.logger = options.logger ?? (message => console.warn(message));
  }

  async start(thread: AnyThreadChannel, context?: TaskRenderContext): Promise<void> {
    if (this.thread) throw new Error('Task renderer has already been started');
    this.thread = thread;
    if (this.editIntervalMs > 0) {
      this.editTimer = setInterval(() => {
        void this.flush();
      }, this.editIntervalMs);
    }
    if (context) await this.updateCard(context);
  }

  async updateCard(context: TaskRenderContext): Promise<void> {
    if (this.disposed) return;
    this.latestCardContext = context;
    if (this.cardUpdateScheduled) return this.cardQueue;
    this.cardUpdateScheduled = true;
    const queued = this.cardQueue.then(async () => {
      this.cardUpdateScheduled = false;
      const latest = this.latestCardContext;
      if (latest) await this.renderControlCard(latest);
    });
    this.cardQueue = queued.catch(error => {
      this.logger(`[taskRenderer] Card update failed; queue recovered: ${redactErrorMessage(error)}`);
    });
    return queued;
  }

  async handle(event: AgentEvent): Promise<void> {
    if (this.disposed || this.finalized) return;
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
    if (this.disposed) return;
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

    if (this.latestCardContext) {
      await this.updateCard({ ...this.latestCardContext, result });
    }

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
    await this.sendEmbed(embed, content);
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

  private async sendEmbed(embed: EmbedBuilder, content?: string): Promise<void> {
    const thread = this.requireThread();
    try {
      await thread.send({ ...(content === undefined ? {} : { content }), embeds: [embed] });
    } catch (error) {
      this.logger(`[taskRenderer] Embed send failed; sending plain text: ${redactErrorMessage(error)}`);
      const fallback = truncateDiscordMessage([content, plainTextFromEmbed(embed)].filter(Boolean).join('\n') || 'Task update');
      await thread.send(fallback).catch(fallbackError => {
        this.logger(`[taskRenderer] Plain-text fallback failed: ${redactErrorMessage(fallbackError)}`);
      });
    }
  }

  private async renderControlCard(context: TaskRenderContext): Promise<void> {
    const thread = this.requireThread();
    this.controlCardTaskId = context.task.id;
    const stored = this.controlCardStore?.getControlCard(context.task.id);
    let persistedPinState = stored?.pinState;
    if (!this.controlCardMessage && stored?.messageId && 'messages' in thread && thread.messages && typeof thread.messages.fetch === 'function') {
      this.controlCardMessage = await thread.messages.fetch(stored.messageId).catch(error => {
        if (isMessageNotFound(error)) return null;
        throw error;
      }) as TaskControlCardMessage | null;
      if (!this.controlCardMessage && persistedPinState !== 'failed') {
        persistedPinState = 'unknown';
        this.controlCardPinAttempted = false;
      }
    }

    const view: TaskControlCardView = {
      taskId: context.task.id,
      objective: context.task.objective,
      projectName: context.task.projectName,
      provider: context.task.provider,
      ...(context.task.settings?.model ? { model: context.task.settings.model } : {}),
      status: context.task.status,
      ...(context.worktree?.branchName ? { branchName: context.worktree.branchName } : {}),
      sessionState: context.task.status === 'interrupted'
        ? 'preserved'
        : context.task.providerSessionId ? 'active' : 'not_started',
      ...(context.phase ? { phase: context.phase } : {}),
      ...(context.usagePosture ? { usagePosture: context.usagePosture } : {}),
      ...(context.result ? { result: context.result } : {}),
    };
    const payload = renderTaskControlCard(view, { embeds: !this.controlCardEmbedsDisabled && this.controlCardCanEmbed(thread) });
    if (!this.controlCardMessage) {
      try {
        this.controlCardMessage = await thread.send(payload) as unknown as TaskControlCardMessage;
      } catch (error) {
        if (!payload.embeds?.length) throw error;
        this.logger(`[taskRenderer] Control-card embed send failed; using plain text: ${redactErrorMessage(error)}`);
        this.controlCardEmbedsDisabled = true;
        this.controlCardMessage = await thread.send({ content: truncateDiscordMessage(plainTextFromEmbed(payload.embeds[0])) }) as unknown as TaskControlCardMessage;
      }
      if (this.controlCardStore && this.controlCardMessage.id) {
        this.controlCardStore.saveControlCard(context.task.id, {
          messageId: this.controlCardMessage.id,
          pinState: persistedPinState ?? 'unknown',
        });
      }
    } else {
      try {
        await this.controlCardMessage.edit(payload);
      } catch (error) {
        this.logger(`[taskRenderer] Control-card edit failed; sending plain text: ${redactErrorMessage(error)}`);
        this.controlCardEmbedsDisabled = true;
        try {
          await this.controlCardMessage.edit(payload.embeds?.length
            ? { content: truncateDiscordMessage(plainTextFromEmbed(payload.embeds[0])) }
            : payload);
        } catch (fallbackError) {
          this.logger(`[taskRenderer] Plain-text control-card edit failed; refreshing the card: ${redactErrorMessage(fallbackError)}`);
          this.controlCardMessage = null;
          throw fallbackError;
        }
      }
    }

    if (!this.controlCardPinAttempted && this.controlCardStore && this.controlCardMessage
      && persistedPinState !== 'pinned' && persistedPinState !== 'not_pinned' && persistedPinState !== 'failed') {
      this.controlCardPinAttempted = true;
      if (!this.controlCardCanPin(thread)) {
        this.controlCardStore.saveControlCard(context.task.id, { messageId: this.controlCardMessage.id, pinState: 'not_pinned' });
      } else if (this.controlCardMessage.pin) {
        try {
          await this.controlCardMessage.pin();
          this.controlCardStore.saveControlCard(context.task.id, { messageId: this.controlCardMessage.id, pinState: 'pinned' });
        } catch (error) {
          this.logger(`[taskRenderer] Control-card pin failed: ${redactErrorMessage(error)}`);
          this.controlCardStore.saveControlCard(context.task.id, { messageId: this.controlCardMessage.id, pinState: 'failed' });
        }
      } else {
        this.controlCardStore.saveControlCard(context.task.id, { messageId: this.controlCardMessage.id, pinState: 'failed' });
      }
    }
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

function isMessageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return candidate.code === 10008 || candidate.status === 404 || candidate.statusCode === 404;
}

function plainTextFromEmbed(embed: EmbedBuilder): string {
  const data = embed.toJSON();
  return [data.title, data.description, ...(data.fields ?? []).map(field => `${field.name}: ${field.value}`)]
    .filter(Boolean)
    .join('\n') || 'Task update';
}

function truncateDiscordMessage(text: string): string {
  return text.length <= DISCORD_MESSAGE_LIMIT ? text : `${text.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

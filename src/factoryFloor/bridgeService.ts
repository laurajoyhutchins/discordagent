import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  type ColorResolvable,
} from 'discord.js';
import type {
  FactoryFloorApproval,
  FactoryFloorClient,
  FactoryFloorRunState,
  FactoryFloorRunStatus,
  FactoryFloorStatus,
  FactoryFloorTaskReceipt,
  FactoryFloorTaskRequest,
} from './client.js';
import type {
  FactoryFloorRunBinding,
  FactoryFloorRunRepository,
} from '../repositories/factoryFloorRunRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';

const TERMINAL = new Set<FactoryFloorRunState>([
  'completed',
  'failed',
  'cancelled',
  'rejected',
]);

export interface FactoryFloorBridgeOptions {
  pollIntervalMs?: number;
  pollingEnabled?: boolean;
}

export interface BindFactoryFloorRunInput {
  receipt: FactoryFloorTaskReceipt;
  projectName: string;
  repository: string;
  objective: string;
  requestedBy: string;
  guildId: string;
  channelId: string;
  threadId: string;
  statusMessageId: string;
}

export class FactoryFloorBridgeService {
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly api: FactoryFloorClient,
    private readonly runs: FactoryFloorRunRepository,
    private readonly discord: Client,
    private readonly options: FactoryFloorBridgeOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.refreshActive();
    if (this.options.pollingEnabled === false) return;
    const interval = this.options.pollIntervalMs ?? 15_000;
    if (!Number.isInteger(interval) || interval < 5_000)
      throw new Error('Factory Floor polling interval must be at least 5000 ms');
    this.pollTimer = setInterval(() => {
      void this.refreshActive().catch(error => {
        console.warn('[factory-floor] Polling failed:', redactErrorMessage(error));
      });
    }, interval);
    this.pollTimer.unref?.();
  }

  close(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  getFactoryStatus(principalId: string): Promise<FactoryFloorStatus> {
    return this.api.getStatus(principalId);
  }

  submitTask(
    principalId: string,
    input: FactoryFloorTaskRequest,
  ): Promise<FactoryFloorTaskReceipt> {
    return this.api.submitTask(principalId, input);
  }

  bindRun(input: BindFactoryFloorRunInput): FactoryFloorRunBinding {
    return this.runs.create({
      runId: input.receipt.runId,
      projectName: input.projectName,
      repository: input.repository,
      objective: input.objective,
      requestedBy: input.requestedBy,
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.threadId,
      statusMessageId: input.statusMessageId,
      status: normalizeState(input.receipt.status),
    });
  }

  findByRunId(runId: string): FactoryFloorRunBinding | undefined {
    return this.runs.findByRunId(runId);
  }

  findByThreadId(threadId: string): FactoryFloorRunBinding | undefined {
    return this.runs.findByThreadId(threadId);
  }

  async refreshRun(
    runId: string,
    principalId = 'discord-agent:poller',
  ): Promise<FactoryFloorRunStatus> {
    const binding = this.runs.findByRunId(runId);
    if (!binding) throw new Error(`Factory Floor run ${runId} is not bound to Discord`);
    try {
      const status = await this.api.getRun(principalId, runId);
      const updated = this.runs.updateStatus(runId, status.status);
      await this.updateStatusMessage(updated, status);
      return status;
    } catch (error) {
      const message = redactErrorMessage(error);
      this.runs.recordError(runId, message);
      throw error;
    }
  }

  async cancelRun(runId: string, userId: string, requestId: string): Promise<FactoryFloorRunStatus> {
    await this.api.cancelRun(`discord:${userId}`, runId, {
      clientRequestId: requestId,
      reason: `Cancelled by Discord user ${userId}.`,
    });
    return this.refreshRun(runId, `discord:${userId}`);
  }

  listApprovals(userId: string, limit = 10): Promise<FactoryFloorApproval[]> {
    return this.api.listApprovals(`discord:${userId}`, limit);
  }

  decideApproval(
    approvalId: string,
    userId: string,
    requestId: string,
    decision: 'approve' | 'reject',
  ): Promise<unknown> {
    return this.api.decideApproval(`discord:${userId}`, approvalId, {
      clientRequestId: requestId,
      decision,
      reason: `${decision === 'approve' ? 'Approved' : 'Rejected'} by Discord user ${userId}.`,
    });
  }

  async refreshActive(): Promise<void> {
    for (const binding of this.runs.listActive()) {
      try {
        await this.refreshRun(binding.runId);
      } catch (error) {
        console.warn(
          `[factory-floor] Failed to refresh run ${binding.runId}:`,
          redactErrorMessage(error),
        );
      }
    }
  }

  private async updateStatusMessage(
    binding: FactoryFloorRunBinding,
    status: FactoryFloorRunStatus,
  ): Promise<void> {
    const channel = await this.discord.channels.fetch(binding.threadId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel))
      throw new Error(`Discord thread ${binding.threadId} is unavailable`);
    const message = await channel.messages.fetch(binding.statusMessageId);
    await message.edit({
      embeds: [buildRunEmbed(binding, status)],
      components: buildRunComponents(binding.runId, TERMINAL.has(status.status)),
    });
  }
}

export function buildRunEmbed(
  binding: FactoryFloorRunBinding,
  status: FactoryFloorRunStatus,
): EmbedBuilder {
  const counts = status.counts;
  const lines = [
    `**Repository:** \`${binding.repository}\``,
    `**Run:** \`${binding.runId}\``,
    `**State:** ${status.status}`,
    counts
      ? `**Work:** ${counts.queued} queued · ${counts.active} active · ${counts.completed} completed · ${counts.failed} failed · ${counts.cancelled} cancelled`
      : undefined,
    status.retryCount ? `**Retries:** ${status.retryCount}` : undefined,
    status.pendingApprovalCount
      ? `**Pending approvals:** ${status.pendingApprovalCount}`
      : undefined,
    status.terminalResultSummary
      ? `**Result:** ${status.terminalResultSummary}`
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return new EmbedBuilder()
    .setTitle(binding.objective.slice(0, 256))
    .setDescription(lines.join('\n'))
    .setColor(stateColor(status.status))
    .setFooter({ text: 'Factory Floor is authoritative; this card is a projection.' })
    .setTimestamp();
}

export function buildRunComponents(runId: string, terminal: boolean) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ff_refresh:${runId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );
  if (!terminal)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ff_cancel:${runId}`)
        .setLabel('Cancel run')
        .setStyle(ButtonStyle.Danger),
    );
  return [row];
}

function normalizeState(value: string): FactoryFloorRunState {
  return [
    'accepted',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
    'rejected',
  ].includes(value)
    ? (value as FactoryFloorRunState)
    : 'accepted';
}

function stateColor(state: FactoryFloorRunState): ColorResolvable {
  if (state === 'completed') return 0x57f287;
  if (state === 'failed' || state === 'rejected') return 0xed4245;
  if (state === 'cancelled') return 0x747f8d;
  if (state === 'running') return 0x5865f2;
  return 0xfee75c;
}

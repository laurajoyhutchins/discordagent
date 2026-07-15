import type { AgentEvent, PlanItem, ProviderUsage, TaskResult, ToolState } from '../contracts.js';
import { isRecord } from './protocol.js';

export interface AdaptedCodexNotification {
  threadId?: string;
  turnId?: string;
  events: AgentEvent[];
  terminal?: TaskResult;
}

export function adaptCodexNotification(method: string, params: unknown, startedAt = Date.now()): AdaptedCodexNotification {
  const p = isRecord(params) ? params : {};
  const turn = isRecord(p.turn) ? p.turn : undefined;
  const item = isRecord(p.item) ? p.item : undefined;
  const threadId = stringValue(p.threadId ?? (isRecord(p.thread) ? p.thread.id : undefined));
  const turnId = stringValue(p.turnId ?? turn?.id);
  const base = { ...(threadId ? { threadId } : {}), ...(turnId ? { turnId } : {}) };

  if (method === 'item/agentMessage/delta') {
    const text = stringValue(p.delta ?? p.text);
    return { ...base, events: text ? [{ type: 'text_delta', text }] : [] };
  }
  if (method === 'turn/plan/updated') {
    return { ...base, events: [{ type: 'plan', items: normalizePlan(p.plan) }] };
  }
  if (method === 'item/plan/delta') {
    const text = stringValue(p.delta ?? p.text);
    return { ...base, events: text ? [{ type: 'status', phase: 'plan', detail: text }] : [] };
  }
  if (method === 'item/commandExecution/outputDelta') {
    const output = stringValue(p.delta ?? p.output);
    return { ...base, events: output ? [{ type: 'command', command: 'Command output', state: 'running', output }] : [] };
  }
  if (method === 'turn/diff/updated') {
    const diff = stringValue(p.diff);
    return { ...base, events: diff ? [{ type: 'file_change', paths: [], summary: diff }] : [] };
  }
  if ((method === 'item/started' || method === 'item/completed') && item) {
    return { ...base, events: adaptItem(item, method === 'item/completed') };
  }
  if (method === 'thread/tokenUsage/updated') {
    const usageRoot = isRecord(p.tokenUsage) ? p.tokenUsage : isRecord(p.usage) ? p.usage : p;
    const usage = isRecord(usageRoot.total) ? normalizeUsage(usageRoot.total) : normalizeUsage(usageRoot);
    return { ...base, events: [{ type: 'usage', usage }] };
  }
  if (method === 'turn/completed') {
    const status = stringValue(turn?.status ?? p.status) ?? 'completed';
    const outcome = status === 'interrupted'
      ? 'interrupted'
      : status === 'failed'
        ? 'failed'
        : status === 'cancelled'
          ? 'cancelled'
          : 'completed';
    const error = isRecord(turn?.error) ? turn.error : isRecord(p.error) ? p.error : undefined;
    const message = stringValue(error?.message ?? p.summary ?? p.message);
    const usageRoot = isRecord(turn?.usage) ? turn.usage : isRecord(p.usage) ? p.usage : undefined;
    const completedAt = Date.now();
    const result: TaskResult = {
      provider: 'codex',
      outcome,
      exitType: status,
      startedAt,
      completedAt,
      ...(threadId ? { sessionId: threadId } : {}),
      ...(message ? { summary: message } : {}),
      ...(usageRoot ? { usage: normalizeUsage(isRecord(usageRoot.total) ? usageRoot.total : usageRoot) } : {}),
      ...(outcome === 'failed' && message ? { error: { code: codexErrorCode(error), message, retryable: isRetryable(error) } } : {}),
    };
    return { ...base, events: [{ type: 'completed', result }], terminal: result };
  }
  if (method === 'error') {
    const error = isRecord(p.error) ? p.error : p;
    const message = stringValue(error.message) ?? 'Codex App Server reported an error';
    return { ...base, events: [{ type: 'failed', error: { code: codexErrorCode(error), message, retryable: isRetryable(error) } }] };
  }
  if (method === 'warning' || method === 'configWarning' || method === 'model/rerouted' || method === 'model/safetyBuffering/updated' || method === 'model/verification') {
    return { ...base, events: [{ type: 'status', phase: method, ...(statusDetail(p) ? { detail: statusDetail(p) } : {}) }] };
  }
  return { ...base, events: [] };
}

function adaptItem(item: Record<string, unknown>, completed: boolean): AgentEvent[] {
  const type = stringValue(item.type);
  if (type === 'commandExecution') {
    const command = stringValue(item.command) ?? 'Command';
    const output = stringValue(item.aggregatedOutput);
    return [{ type: 'command', command, state: toolState(item.status, completed), ...(output ? { output } : {}) }];
  }
  if (type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
    const paths = changes.flatMap(change => stringValue(change.path) ? [stringValue(change.path)!] : []);
    const summary = changes.flatMap(change => stringValue(change.diff) ? [stringValue(change.diff)!] : []).join('\n');
    return [{ type: 'file_change', paths, ...(summary ? { summary } : {}) }];
  }
  if (type === 'plan') {
    const text = stringValue(item.text);
    return text ? [{ type: 'plan', items: [{ id: stringValue(item.id), text, status: completed ? 'completed' : 'in_progress' }] }] : [];
  }
  if (type === 'agentMessage' && completed) {
    // Deltas are the streaming source; the final item is authoritative but would duplicate rendered text.
    return [];
  }
  if (type === 'contextCompaction') return [{ type: 'status', phase: 'context_compaction' }];
  if (type === 'webSearch') return [{ type: 'status', phase: 'web_search', ...(stringValue(item.query) ? { detail: stringValue(item.query) } : {}) }];
  return [];
}

function normalizePlan(value: unknown): PlanItem[] {
  const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.items) ? value.items : [];
  return items.flatMap((entry, index) => {
    if (typeof entry === 'string') return [{ id: String(index), text: entry, status: 'pending' as const }];
    if (!isRecord(entry)) return [];
    const text = stringValue(entry.step ?? entry.text);
    if (!text) return [];
    const raw = stringValue(entry.status);
    const status: PlanItem['status'] = raw === 'completed'
      ? 'completed'
      : raw === 'inProgress' || raw === 'in_progress'
        ? 'in_progress'
        : raw === 'blocked'
          ? 'blocked'
          : 'pending';
    return [{ id: stringValue(entry.id) ?? String(index), text, status }];
  });
}

function toolState(value: unknown, completed: boolean): ToolState {
  const raw = stringValue(value);
  if (raw === 'failed' || raw === 'declined') return 'failed';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'completed' || completed) return 'completed';
  return 'running';
}

function normalizeUsage(p: Record<string, unknown>): ProviderUsage {
  const inputTokens = numberValue(p.inputTokens ?? p.input_tokens);
  const outputTokens = numberValue(p.outputTokens ?? p.output_tokens);
  const cachedInputTokens = numberValue(p.cachedInputTokens ?? p.cached_input_tokens);
  const totalTokens = numberValue(p.totalTokens ?? p.total_tokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
  return { inputTokens, outputTokens, cachedInputTokens, totalTokens };
}

function statusDetail(p: Record<string, unknown>): string | undefined {
  if (typeof p.message === 'string') return p.message;
  if (typeof p.summary === 'string') return p.summary;
  if (typeof p.reason === 'string') return p.reason;
  if (typeof p.toModel === 'string') return `Rerouted to ${p.toModel}`;
  return undefined;
}

function codexErrorCode(error: Record<string, unknown> | undefined): string {
  const info = error && isRecord(error.codexErrorInfo) ? error.codexErrorInfo : undefined;
  return stringValue(info?.type ?? info?.code) ?? 'codex_error';
}

function isRetryable(error: Record<string, unknown> | undefined): boolean {
  const code = codexErrorCode(error);
  return !['BadRequest', 'Unauthorized', 'ContextWindowExceeded'].includes(code);
}

function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

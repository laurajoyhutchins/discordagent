import type {
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  PlanItem,
  ProviderUsage,
  TaskResult,
  ToolState,
} from '../contracts.js';
import {
  redactAgentEvent,
  redactApprovalRequest,
  redactSensitiveText,
  redactTaskResult,
  safeStringify,
} from '../../utils/redaction.js';

type RecordValue = Record<string, unknown>;

export interface OpenCodeEventAdapter {
  adaptSessionUpdate(params: unknown): AgentEvent[];
}

export function adaptSessionUpdate(params: unknown): AgentEvent[] {
  return createOpenCodeEventAdapter().adaptSessionUpdate(params);
}

export function createOpenCodeEventAdapter(): OpenCodeEventAdapter {
  const toolCalls = new Map<string, RecordValue>();
  const terminalStates = new Map<string, Set<ToolState>>();
  let sessionId: string | undefined;

  return {
    adaptSessionUpdate(params: unknown): AgentEvent[] {
      const root = isRecord(params) ? params : undefined;
      if (root) {
        const nextSessionId = stringValue(root.sessionId);
        if (nextSessionId && sessionId && nextSessionId !== sessionId) {
          toolCalls.clear();
          terminalStates.clear();
        }
        if (nextSessionId) sessionId = nextSessionId;
      }

      const update = root && isRecord(root.update) ? root.update : root;
      if (!update) return [];

      const events = adaptUpdate(update, toolCalls, terminalStates);
      return events.map(redactAgentEvent);
    },
  };
}

export function approvalRequestFromAcp(params: unknown): ApprovalRequest {
  const root = isRecord(params) ? params : {};
  const toolCall = isRecord(root.toolCall) ? root.toolCall : {};
  const kind = approvalKind(toolCall.kind);
  const title = stringValue(toolCall.title) ?? 'OpenCode tool request';
  const details = toolDetails(toolCall);
  const request: ApprovalRequest = {
    id: stringValue(toolCall.toolCallId) ?? stringValue(root.sessionId) ?? 'opencode-permission',
    kind,
    title,
    details,
    ...(kind === 'command' || kind === 'file_change' ? { risk: 'high' as const } : { risk: 'medium' as const }),
  };
  return redactApprovalRequest(request);
}

export function permissionOutcome(decision: ApprovalDecision, options: readonly unknown[]): unknown {
  const candidates = options.flatMap(option => {
    if (!isRecord(option)) return [];
    const optionId = stringValue(option.optionId);
    const kind = stringValue(option.kind);
    return optionId && kind ? [{ optionId, kind }] : [];
  });

  const desired = decision === 'allow' ? ['allow_once'] : ['reject_once'];
  const selected = desired.map(kind => candidates.find(option => option.kind === kind)).find(Boolean);
  return selected
    ? { outcome: 'selected', optionId: selected.optionId }
    : { outcome: 'cancelled' };
}

export function taskResultFromPrompt(input: {
  provider: 'opencode';
  startedAt: number;
  completedAt: number;
  sessionId: string;
  promptResult: unknown;
  text: string;
}): TaskResult {
  const promptResult = isRecord(input.promptResult) ? input.promptResult : {};
  const stopReason = stringValue(promptResult.stopReason) ?? 'unknown';
  const outcome = stopReason === 'cancelled'
    ? 'cancelled'
    : stopReason === 'refusal'
      ? 'failed'
      : 'completed';
  const summary = input.text.length > 0 ? redactSensitiveText(input.text) : undefined;
  const result: TaskResult = {
    provider: input.provider,
    outcome,
    exitType: stopReason,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    sessionId: input.sessionId,
    ...(summary ? { summary } : {}),
    ...(normalizePromptUsage(promptResult.usage) ? { usage: normalizePromptUsage(promptResult.usage) } : {}),
    ...(outcome === 'failed'
      ? {
          error: {
            code: 'opencode_refusal',
            message: summary ?? 'OpenCode refused the prompt',
            retryable: false,
          },
        }
      : {}),
  };
  return redactTaskResult(result);
}

function adaptUpdate(
  update: RecordValue,
  toolCalls: Map<string, RecordValue>,
  terminalStates: Map<string, Set<ToolState>>,
): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return textChunk(update);
    case 'agent_thought_chunk':
    case 'user_message_chunk':
      return [];
    case 'plan':
      return planEvent(update.entries);
    case 'plan_update': {
      const plan = isRecord(update.plan) ? update.plan : {};
      return planEvent(plan.entries);
    }
    case 'tool_call':
      return toolEvents(update, 'requested', toolCalls, terminalStates);
    case 'tool_call_update':
      return toolEvents(update, 'running', toolCalls, terminalStates);
    case 'usage_update':
      return usageEvent(update);
    default:
      return [];
  }
}

function textChunk(update: RecordValue): AgentEvent[] {
  const content = isRecord(update.content) ? update.content : {};
  const text = stringValue(content.text);
  return content.type === 'text' && text ? [{ type: 'text_delta', text }] : [];
}

function planEvent(value: unknown): AgentEvent[] {
  if (!Array.isArray(value)) return [];
  const items: PlanItem[] = value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const text = stringValue(entry.content);
    if (!text) return [];
    return [{
      id: String(index),
      text,
      status: planStatus(entry.status),
    }];
  });
  return [{ type: 'plan', items }];
}

function toolEvents(
  update: RecordValue,
  fallback: ToolState,
  toolCalls: Map<string, RecordValue>,
  terminalStates: Map<string, Set<ToolState>>,
): AgentEvent[] {
  const toolCallId = stringValue(update.toolCallId);
  const previous = toolCallId ? toolCalls.get(toolCallId) : undefined;
  const merged = mergeDefined(previous, update);
  if (toolCallId) toolCalls.set(toolCallId, merged);

  const title = stringValue(update.title) ?? 'OpenCode tool call';
  const effectiveTitle = stringValue(merged.title) ?? title;
  const state = toolState(merged.status, fallback);
  const kind = stringValue(merged.kind);
  if (toolCallId && (state === 'completed' || state === 'failed')) {
    const seenTerminalStates = terminalStates.get(toolCallId) ?? new Set<ToolState>();
    if (seenTerminalStates.has(state)) return [];
    seenTerminalStates.add(state);
    terminalStates.set(toolCallId, seenTerminalStates);
  }

  if (kind === 'execute') {
    const commandInput = commandInputText(merged.rawInput);
    const command = commandInput ? `${effectiveTitle} ${commandInput}` : effectiveTitle;
    const output = serialized(merged.rawOutput);
    return [{
      type: 'command',
      command,
      state,
      ...(output ? { output } : {}),
    }];
  }

  const detail = toolDetail(merged);
  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    return [{
      type: 'file_change',
      paths: toolPaths(merged),
      summary: redactSensitiveText(`${effectiveTitle} (${state})${detail ? `\n${detail}` : ''}`),
    }];
  }

  return [{
    type: 'status',
    phase: `tool:${kind ?? 'unknown'}:${state}`,
    ...(detail ? { detail } : {}),
  }];
}

function mergeDefined(previous: RecordValue | undefined, update: RecordValue): RecordValue {
  const merged: RecordValue = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function toolDetail(update: RecordValue): string | undefined {
  return [serialized(update.rawInput), serialized(update.rawOutput)]
    .filter((value): value is string => Boolean(value))
    .join('\n') || undefined;
}

function usageEvent(update: RecordValue): AgentEvent[] {
  const used = finiteNumber(update.used);
  const size = finiteNumber(update.size);
  if (used === undefined) return [];
  const usage: ProviderUsage = {
    totalTokens: used,
    ...(size !== undefined && size > 0 ? { utilization: used / size } : {}),
  };
  return [{ type: 'usage', usage }];
}

function toolPaths(update: RecordValue): string[] {
  const kind = stringValue(update.kind);
  if (!['edit', 'delete', 'move'].includes(kind ?? '')) return [];
  if (!Array.isArray(update.locations)) return [];
  return update.locations.flatMap(location => {
    if (!isRecord(location)) return [];
    const path = stringValue(location.path);
    return path ? [path] : [];
  });
}

function toolDetails(toolCall: RecordValue): string {
  const input = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;
  const command = stringValue(input?.command ?? input?.cmd);
  if (command) return redactSensitiveText(command);
  const path = stringValue(input?.path ?? input?.file_path);
  if (path) return redactSensitiveText(path);
  const serializedInput = serialized(toolCall.rawInput);
  const serializedOutput = serialized(toolCall.rawOutput);
  return [serializedInput, serializedOutput].filter((value): value is string => Boolean(value)).join('\n')
    || 'OpenCode requested permission to use a tool';
}

function commandInputText(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (isRecord(input)) {
    const command = stringValue(input.command ?? input.cmd);
    if (command) return redactSensitiveText(command);
  }
  return serialized(input);
}

function serialized(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return safeStringify(value);
}

function approvalKind(value: unknown): ApprovalRequest['kind'] {
  if (value === 'execute') return 'command';
  if (value === 'edit' || value === 'delete' || value === 'move') return 'file_change';
  return 'tool';
}

function toolState(value: unknown, fallback: ToolState): ToolState {
  switch (value) {
    case 'pending':
      return 'requested';
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return fallback;
  }
}

function planStatus(value: unknown): PlanItem['status'] {
  if (value === 'in_progress') return 'in_progress';
  if (value === 'completed') return 'completed';
  if (value === 'blocked') return 'blocked';
  return 'pending';
}

function normalizePromptUsage(value: unknown): ProviderUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = finiteNumber(value.inputTokens);
  const outputTokens = finiteNumber(value.outputTokens);
  const cachedInputTokens = finiteNumber(value.cachedReadTokens);
  const totalTokens = finiteNumber(value.totalTokens)
    ?? (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const usage: ProviderUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

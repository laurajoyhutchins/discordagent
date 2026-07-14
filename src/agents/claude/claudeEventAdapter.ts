import type {
  AgentEvent,
  NormalizedAgentError,
  ProviderSession,
  ProviderUsage,
  TaskResult,
} from '../contracts.js';

export interface ClaudeAdaptationContext {
  startedAt: number;
  now: () => number;
}

export interface ClaudeMessageAdaptation {
  session?: ProviderSession;
  events: AgentEvent[];
  result?: TaskResult;
  rateLimitInfo?: Record<string, unknown>;
  rawResult?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizedUsage(raw: unknown): ProviderUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const inputTokens = numberValue(raw.input_tokens ?? raw.inputTokens);
  const outputTokens = numberValue(raw.output_tokens ?? raw.outputTokens);
  const cachedInputTokens = numberValue(
    raw.cache_read_input_tokens ?? raw.cacheReadInputTokens ?? raw.cachedInputTokens,
  );
  const explicitTotal = numberValue(raw.total_tokens ?? raw.totalTokens);
  const totalTokens = explicitTotal ?? (
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined
  );

  const usage: ProviderUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function rateLimitUsage(info: Record<string, unknown>): ProviderUsage | undefined {
  const utilization = numberValue(info.utilization);
  const resetsAt = numberValue(info.resetsAt);
  if (utilization === undefined && resetsAt === undefined) return undefined;
  return {
    ...(utilization === undefined ? {} : { utilization }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function resultError(message: Record<string, unknown>): NormalizedAgentError {
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    code: stringValue(message.subtype) ?? 'claude_error',
    message: errors.join('\n') || stringValue(message.stop_reason) || 'Claude execution failed',
    retryable: false,
  };
}

export function classifyClaudeError(error: unknown): NormalizedAgentError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const encoding = lower.includes('not valid json')
    || lower.includes('lone surrogate')
    || lower.includes('unpaired surrogate');
  return {
    code: encoding ? 'session_encoding_error' : 'claude_provider_error',
    message,
    retryable: encoding || lower.includes('rate limit') || lower.includes('temporar'),
  };
}

export function adaptClaudeMessage(
  message: unknown,
  context: ClaudeAdaptationContext,
): ClaudeMessageAdaptation {
  if (!isRecord(message)) return { events: [] };

  const sessionId = stringValue(message.session_id);
  const session = sessionId
    ? { provider: 'claude' as const, sessionId, createdAt: context.now() }
    : undefined;

  if (message.type === 'assistant') {
    const nested = isRecord(message.message) ? message.message : undefined;
    const content = Array.isArray(nested?.content) ? nested.content : [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (isRecord(block) && typeof block.text === 'string' && block.text.length > 0) {
        events.push({ type: 'text_delta', text: block.text });
      }
    }
    return { session, events };
  }

  if (message.type === 'rate_limit_event' && isRecord(message.rate_limit_info)) {
    const usage = rateLimitUsage(message.rate_limit_info);
    return {
      session,
      events: usage ? [{ type: 'usage', usage }] : [],
      rateLimitInfo: message.rate_limit_info,
    };
  }

  if (message.type === 'result') {
    const success = message.subtype === 'success';
    const usage = normalizedUsage(message.usage);
    const result: TaskResult = {
      provider: 'claude',
      outcome: success ? 'completed' : 'failed',
      exitType: stringValue(message.subtype) ?? 'unknown',
      startedAt: context.startedAt,
      completedAt: context.now(),
      ...(sessionId ? { sessionId } : {}),
      ...(success && typeof message.result === 'string' ? { summary: message.result } : {}),
      ...(usage ? { usage } : {}),
      ...(numberValue(message.total_cost_usd) === undefined
        ? {}
        : { costUsd: numberValue(message.total_cost_usd) }),
      ...(numberValue(message.duration_ms) === undefined
        ? {}
        : { durationMs: numberValue(message.duration_ms) }),
      ...(numberValue(message.num_turns) === undefined
        ? {}
        : { numTurns: numberValue(message.num_turns) }),
      ...(success ? {} : { error: resultError(message) }),
    };
    return {
      session,
      result,
      rawResult: message,
      events: success
        ? [{ type: 'completed', result }]
        : [{ type: 'failed', error: result.error! }],
    };
  }

  if (message.type === 'system' && message.subtype === 'status') {
    const status = typeof message.status === 'string'
      ? message.status
      : JSON.stringify(message.status ?? 'working');
    return { session, events: [{ type: 'status', phase: status }] };
  }

  return { session, events: [] };
}

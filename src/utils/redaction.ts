import type {
  AgentEvent,
  ApprovalRequest,
  NormalizedAgentError,
  PlanItem,
  TaskResult,
  UserQuestion,
  UserQuestionOption,
} from '../agents/contracts.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_ASSIGNMENT = /((?:["']?)(?:[a-z0-9_]*(?:token|secret|password|api[_-]?key|private[_-]?key|authorization|cookie|credential)[a-z0-9_]*|api[-_]?key|access[-_]?token|user[_-]?code|device[_-]?code|verification(?:[_-]?(?:url|uri|code))?)(?:["']?)\s*[:=]\s*)(?:Bearer\s+[^\s,;]+|"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const OPENAI_TOKEN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_-]{8,})\b/g;

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return [
    'token',
    'secret',
    'password',
    'apikey',
    'privatekey',
    'authorization',
    'cookie',
    'credential',
    'usercode',
    'devicecode',
    'verification',
    'verificationurl',
    'verificationuri',
    'verificationcode',
  ].some(fragment => normalized.includes(fragment));
}

export function redactErrorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(OPENAI_TOKEN, REDACTED)
    .replace(GITHUB_TOKEN, REDACTED);
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    sensitiveKey(key) ? REDACTED : redactSensitiveValue(child),
  ]));
}

export function safeStringify(value: unknown): string {
  return JSON.stringify(redactSensitiveValue(value));
}

function redactError(error: NormalizedAgentError): NormalizedAgentError {
  return {
    ...error,
    message: redactSensitiveText(error.message),
    ...(error.details ? { details: redactSensitiveText(error.details) } : {}),
  };
}

export function redactTaskResult(result: TaskResult): TaskResult {
  return {
    ...result,
    ...(result.summary ? { summary: redactSensitiveText(result.summary) } : {}),
    ...(result.verification
      ? { verification: result.verification.map(redactSensitiveText) }
      : {}),
    ...(result.unresolved
      ? { unresolved: result.unresolved.map(redactSensitiveText) }
      : {}),
    ...(result.error ? { error: redactError(result.error) } : {}),
  };
}

function redactPlanItem(item: PlanItem): PlanItem {
  return { ...item, text: redactSensitiveText(item.text) };
}

export function redactApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    title: redactSensitiveText(request.title),
    details: redactSensitiveText(request.details),
  };
}

function redactQuestionOption(option: UserQuestionOption): UserQuestionOption {
  return {
    ...option,
    label: redactSensitiveText(option.label),
    value: redactSensitiveText(option.value),
    ...(option.description
      ? { description: redactSensitiveText(option.description) }
      : {}),
  };
}

export function redactUserQuestion(question: UserQuestion): UserQuestion {
  return {
    ...question,
    prompt: redactSensitiveText(question.prompt),
    ...(question.options
      ? { options: question.options.map(redactQuestionOption) }
      : {}),
  };
}

export function redactAgentEvent(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case 'text_delta':
      return { ...event, text: redactSensitiveText(event.text) };
    case 'status':
      return {
        ...event,
        ...(event.detail ? { detail: redactSensitiveText(event.detail) } : {}),
      };
    case 'plan':
      return { ...event, items: event.items.map(redactPlanItem) };
    case 'command':
      return {
        ...event,
        command: redactSensitiveText(event.command),
        ...(event.output ? { output: redactSensitiveText(event.output) } : {}),
      };
    case 'file_change':
      return {
        ...event,
        ...(event.summary ? { summary: redactSensitiveText(event.summary) } : {}),
      };
    case 'approval_request':
      return { ...event, request: redactApprovalRequest(event.request) };
    case 'user_question':
      return { ...event, question: redactUserQuestion(event.question) };
    case 'completed':
      return { ...event, result: redactTaskResult(event.result) };
    case 'failed':
      return { ...event, error: redactError(event.error) };
    case 'session_started':
    case 'usage':
      return event;
  }
}

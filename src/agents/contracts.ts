export const AGENT_PROVIDER_IDS = ['claude', 'codex', 'opencode'] as const;
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

/** Provider-neutral host MCP data; adapters own SDK-specific interpretation. */
export type HostMcpServerConfig = Readonly<Record<string, unknown>>;
export type HostMcpServers = Readonly<Record<string, HostMcpServerConfig>>;

export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export class UnsupportedAgentSettingError extends Error {
  readonly name = 'UnsupportedAgentSettingError';

  constructor(readonly provider: AgentProviderId, readonly setting: string) {
    super(`${provider} agent setting ${setting} is not supported`);
  }
}

export interface AgentTaskSettings {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  mcpProfile?: string;
  approvalProfile?: string;
}

export interface AgentTurnSettings {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

export type AgentSettingsScope = 'task' | 'turn';

export const PROVIDER_SETTING_CAPABILITIES = {
  claude: {
    task: ['model', 'timeoutMs', 'mcpProfile'],
    turn: ['model', 'timeoutMs'],
  },
  codex: {
    task: ['model', 'reasoningEffort'],
    turn: ['model', 'reasoningEffort'],
  },
  opencode: {
    task: ['model'],
    turn: ['model'],
  },
} as const satisfies Record<AgentProviderId, Record<AgentSettingsScope, readonly string[]>>;

export function validateSupportedAgentSettings(
  provider: AgentProviderId,
  settings: object,
  scope: AgentSettingsScope,
): void {
  const supported: readonly string[] = PROVIDER_SETTING_CAPABILITIES[provider][scope];
  const unsupported = Object.keys(settings).find(key => !supported.includes(key));
  if (unsupported !== undefined) throw new UnsupportedAgentSettingError(provider, unsupported);
}

export const TASK_STATUSES = [
  'created',
  'starting',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TOOL_STATES = ['requested', 'running', 'completed', 'failed', 'cancelled'] as const;
export type ToolState = (typeof TOOL_STATES)[number];
export const PLAN_ITEM_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];
export const APPROVAL_KINDS = ['command', 'file_change', 'tool'] as const;
export type ApprovalDecision = 'allow' | 'deny' | 'timeout';
export type TaskOutcome = 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface ProviderSession {
  provider: AgentProviderId;
  sessionId: string;
  createdAt: number;
}

export interface ProviderAvailability {
  available: boolean;
  reason?: string;
  authenticationRequired?: boolean;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  utilization?: number;
  resetsAt?: number;
}

export interface PlanItem {
  id?: string;
  text: string;
  status: PlanItemStatus;
}

export interface ApprovalRequest {
  id: string;
  kind: 'command' | 'file_change' | 'tool';
  title: string;
  details: string;
  risk?: 'low' | 'medium' | 'high';
}

export interface UserQuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  prompt: string;
  options?: UserQuestionOption[];
  allowFreeText?: boolean;
  multiple?: boolean;
}

export interface UserAnswer {
  skipped: boolean;
  values: string[];
}

export interface NormalizedAgentError {
  code: string;
  message: string;
  retryable: boolean;
  details?: string;
}

export interface TaskResult {
  provider: AgentProviderId;
  outcome: TaskOutcome;
  exitType: string;
  startedAt: number;
  completedAt: number;
  sessionId?: string;
  summary?: string;
  usage?: ProviderUsage;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  branchName?: string;
  verification?: string[];
  unresolved?: string[];
  error?: NormalizedAgentError;
}

export const AGENT_EVENT_TYPES = [
  'session_started',
  'text_delta',
  'status',
  'plan',
  'command',
  'file_change',
  'approval_request',
  'user_question',
  'usage',
  'completed',
  'failed',
] as const;

export type AgentEvent =
  | { type: 'session_started'; session: ProviderSession }
  | { type: 'text_delta'; text: string }
  | { type: 'status'; phase: string; detail?: string }
  | { type: 'plan'; items: PlanItem[] }
  | { type: 'command'; command: string; state: ToolState; output?: string }
  | { type: 'file_change'; paths: string[]; summary?: string }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'user_question'; question: UserQuestion }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'completed'; result: TaskResult }
  | { type: 'failed'; error: NormalizedAgentError };

export interface StartTaskInput {
  taskId: string;
  projectName: string;
  workingDirectory: string;
  channelId: string;
  threadId: string;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  settings?: AgentTaskSettings;
}

/** Normalize compatibility fields once while keeping the durable settings snapshot authoritative. */
export function normalizeAgentTaskSettings(input: Pick<StartTaskInput, 'settings' | 'model' | 'reasoningEffort'>): AgentTaskSettings {
  return {
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
    ...input.settings,
  };
}

export interface ContinueTaskInput extends StartTaskInput {
  session: ProviderSession;
  turnSettings?: AgentTurnSettings;
}

export interface HandoffEstimateInput {
  sourceProvider: AgentProviderId;
  targetProvider: AgentProviderId;
  transcriptCharacters: number;
  summaryCharacters: number;
  changedFiles: number;
}

export interface HandoffEstimate {
  estimatedInputTokens: number;
  confidence: 'low' | 'medium' | 'high';
  explanation: string;
}

export interface AgentRunHost {
  emit(event: AgentEvent): Promise<void>;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  requestUserInput(request: UserQuestion): Promise<UserAnswer>;
}

export interface ProviderRun {
  session: ProviderSession;
  completion: Promise<TaskResult>;
}

export interface AgentProvider {
  readonly id: AgentProviderId;
  checkAvailability(): Promise<ProviderAvailability>;
  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  cancelTask(sessionId: string): Promise<void>;
  estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate>;
}

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && AGENT_PROVIDER_IDS.includes(value as AgentProviderId);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProviderSession(value: unknown): value is ProviderSession {
  return isRecord(value)
    && isAgentProviderId(value.provider)
    && typeof value.sessionId === 'string'
    && value.sessionId.length > 0
    && typeof value.createdAt === 'number';
}

function isTaskResult(value: unknown): value is TaskResult {
  return isRecord(value)
    && isAgentProviderId(value.provider)
    && ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(value.outcome))
    && typeof value.exitType === 'string'
    && typeof value.startedAt === 'number'
    && typeof value.completedAt === 'number';
}

function isAgentError(value: unknown): value is NormalizedAgentError {
  return isRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean';
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'session_started':
      return isProviderSession(value.session);
    case 'text_delta':
      return typeof value.text === 'string';
    case 'status':
      return typeof value.phase === 'string';
    case 'plan':
      return Array.isArray(value.items)
        && value.items.every(item => isRecord(item)
          && typeof item.text === 'string'
          && typeof item.status === 'string'
          && PLAN_ITEM_STATUSES.includes(item.status as PlanItemStatus));
    case 'command':
      return typeof value.command === 'string'
        && typeof value.state === 'string'
        && TOOL_STATES.includes(value.state as ToolState);
    case 'file_change':
      return Array.isArray(value.paths) && value.paths.every(path => typeof path === 'string');
    case 'approval_request':
      return isRecord(value.request)
        && typeof value.request.id === 'string'
        && typeof value.request.kind === 'string'
        && APPROVAL_KINDS.includes(value.request.kind as ApprovalRequest['kind'])
        && typeof value.request.title === 'string'
        && typeof value.request.details === 'string';
    case 'user_question':
      return isRecord(value.question)
        && typeof value.question.id === 'string'
        && typeof value.question.prompt === 'string';
    case 'usage': {
      const usage = value.usage;
      return isRecord(usage)
        && ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens', 'utilization', 'resetsAt']
          .every(key => usage[key] === undefined || typeof usage[key] === 'number');
    }
    case 'completed':
      return isTaskResult(value.result);
    case 'failed':
      return isAgentError(value.error);
    default:
      return false;
  }
}

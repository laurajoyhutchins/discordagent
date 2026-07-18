import {
  REASONING_EFFORTS,
  type AgentProviderId,
  type AgentTaskSettings,
  type ReasoningEffort,
  type TaskStatus,
} from './agents/contracts.js';
import { validateClaudeTimeout } from './settings/validation.js';

export type ProjectModels = Partial<Record<AgentProviderId, string>>;

export type ProjectReasoningEfforts = Partial<Record<AgentProviderId, ReasoningEffort>>;

export interface Project {
  name: string;
  workingDirectory: string;
  categoryId: string;
  agentChannelId: string;
  defaultProvider: AgentProviderId;
  models?: ProjectModels;
  reasoningEfforts?: ProjectReasoningEfforts;
  baseBranch?: string;
  roborevChannelId?: string;
  legacySessionId?: string;
}

export interface LegacyProject {
  name: string;
  workingDirectory: string;
  categoryId: string;
  claudeChannelId?: string;
  agentChannelId?: string;
  roborevChannelId?: string;
  roborevWebhookId?: string;
  roborevWebhookToken?: string;
  sessionId?: string;
  model?: string;
  defaultProvider?: AgentProviderId;
  models?: ProjectModels;
  reasoningEfforts?: ProjectReasoningEfforts;
  baseBranch?: string;
}

export interface LegacyProjectStore {
  projects: LegacyProject[];
}

export interface TaskRecord {
  id: string;
  projectName: string;
  provider: AgentProviderId;
  status: TaskStatus;
  channelId: string;
  threadId: string;
  objective: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  providerSessionId?: string;
  settings?: AgentTaskSettings;
  settingsMalformed?: boolean;
}

export interface WorktreeRecord {
  id: string;
  taskId: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
  createdAt: number;
  removedAt?: number;
}

export type TaskControlCardPinState = 'unknown' | 'pinned' | 'not_pinned' | 'failed';

export interface TaskControlCardRecord {
  taskId: string;
  messageId: string;
  pinState: TaskControlCardPinState;
  updatedAt: number;
}

export function parseAgentTaskSettings(value: unknown): AgentTaskSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['model', 'reasoningEffort', 'timeoutMs', 'mcpProfile', 'approvalProfile']);
  if (Object.keys(record).some(key => !allowedKeys.has(key))) return undefined;
  const settings: AgentTaskSettings = {};
  if (record.model !== undefined && typeof record.model !== 'string') return undefined;
  if (typeof record.model === 'string' && record.model.trim()) settings.model = record.model;
  if (record.reasoningEffort !== undefined
    && (typeof record.reasoningEffort !== 'string'
      || !REASONING_EFFORTS.includes(record.reasoningEffort as ReasoningEffort))) return undefined;
  if (record.reasoningEffort !== undefined) settings.reasoningEffort = record.reasoningEffort as ReasoningEffort;
  if (record.timeoutMs !== undefined
    && (typeof record.timeoutMs !== 'number' || !Number.isInteger(record.timeoutMs))) return undefined;
  if (record.timeoutMs !== undefined) {
    try { validateClaudeTimeout(record.timeoutMs); } catch { return undefined; }
  }
  if (record.timeoutMs !== undefined) settings.timeoutMs = record.timeoutMs;
  for (const key of ['mcpProfile', 'approvalProfile'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') return undefined;
    if (typeof record[key] === 'string' && record[key].trim()) settings[key] = record[key];
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export function parseStoredAgentTaskSettings(value: string): AgentTaskSettings | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    const settings = parseAgentTaskSettings(parsed);
    if (settings) return settings;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.keys(parsed).length === 0 ? undefined : {};
  } catch {
    return {};
  }
}

export function normalizeProject(input: LegacyProject | Project): Project {
  const agentChannelId = 'agentChannelId' in input && input.agentChannelId
    ? input.agentChannelId
    : 'claudeChannelId' in input
      ? input.claudeChannelId
      : undefined;

  if (!agentChannelId) {
    throw new Error(`Project "${input.name}" is missing an agent channel ID`);
  }

  const legacyModel = 'model' in input ? input.model : undefined;
  const legacySessionId = 'sessionId' in input ? input.sessionId : undefined;
  const models = input.models ?? (legacyModel ? { claude: legacyModel } : undefined);

  return {
    name: input.name,
    workingDirectory: input.workingDirectory,
    categoryId: input.categoryId,
    agentChannelId,
    defaultProvider: input.defaultProvider ?? 'claude',
    models,
    reasoningEfforts: input.reasoningEfforts,
    baseBranch: input.baseBranch,
    roborevChannelId: input.roborevChannelId,
    legacySessionId: 'legacySessionId' in input ? input.legacySessionId : legacySessionId,
  };
}

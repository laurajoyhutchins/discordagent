import type { AgentProviderId, TaskResult, TaskStatus } from './agents/contracts.js';

export interface ProjectModels {
  claude?: string;
  codex?: string;
  opencode?: string;
}

export interface Project {
  name: string;
  workingDirectory: string;
  categoryId: string;
  agentChannelId: string;
  defaultProvider: AgentProviderId;
  models?: ProjectModels;
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
  baseBranch?: string;
}

export interface ProjectStore {
  projects: Project[];
}

export interface LegacyProjectStore {
  projects: LegacyProject[];
}

export interface ActiveSession {
  abortController: AbortController;
  channelId: string;
  threadId: string;
  projectName: string;
  sessionId: string | null;
  startedAt: number;
  busy: boolean;
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

export interface StoredTaskResult {
  taskId: string;
  result: TaskResult;
  createdAt: number;
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
    baseBranch: input.baseBranch,
    roborevChannelId: input.roborevChannelId,
    legacySessionId: 'legacySessionId' in input ? input.legacySessionId : legacySessionId,
  };
}

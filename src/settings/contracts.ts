import type { AgentProviderId, ReasoningEffort } from '../agents/contracts.js';

export type { AgentTaskSettings } from '../agents/contracts.js';

/** Global settings include PM model and reasoning; task reasoning remains project-scoped. */
export interface GlobalAgentSettings {
  defaultProvider?: AgentProviderId;
  claudeModel?: string;
  codexModel?: string;
  openCodeModel?: string;
  primaryAgentModel?: string;
  claudeTimeoutMs?: number;
  usageReserve?: number;
  reasoningEfforts?: Partial<Record<AgentProviderId, ReasoningEffort>>;
}

/** Canonical project fields are read from ProjectRepository; only mcpProfile is mutable in project_settings. */
export interface ProjectAgentSettings {
  defaultProvider?: AgentProviderId;
  claudeModel?: string;
  codexModel?: string;
  openCodeModel?: string;
  reasoningEfforts?: Partial<Record<AgentProviderId, ReasoningEffort>>;
  baseBranch?: string;
  mcpProfile?: string;
  roborevEnabled?: boolean;
  roborevChannelId?: string;
}

export type ProjectAgentSettingsUpdate = Omit<ProjectAgentSettings, 'roborevChannelId' | 'roborevEnabled' | 'mcpProfile'> & {
  mcpProfile?: string | null;
};

export interface McpProfileCatalog {
  profiles: readonly string[];
}

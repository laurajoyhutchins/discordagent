import type { AgentProviderId } from '../agents/contracts.js';

export type { AgentTaskSettings } from '../agents/contracts.js';

export interface GlobalAgentSettings {
  defaultProvider?: AgentProviderId;
  claudeModel?: string;
  codexModel?: string;
  primaryAgentModel?: string;
  claudeTimeoutMs?: number;
  usageReserve?: number;
}

export interface ProjectAgentSettings {
  defaultProvider?: AgentProviderId;
  claudeModel?: string;
  codexModel?: string;
  baseBranch?: string;
  mcpProfile?: string;
  roborevEnabled?: boolean;
  roborevChannelId?: string;
}

export interface McpProfileCatalog {
  profiles: readonly string[];
}

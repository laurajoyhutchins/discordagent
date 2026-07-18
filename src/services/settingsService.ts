import { validateSupportedAgentSettings, type AgentProviderId, type AgentTaskSettings, type ReasoningEffort } from '../agents/contracts.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { ProjectSettingsRepository } from '../repositories/projectSettingsRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';
import type { GlobalAgentSettings, McpProfileCatalog, ProjectAgentSettings, ProjectAgentSettingsUpdate } from '../settings/contracts.js';
import { validateBaseBranch, validateClaudeTimeout, validateMcpProfile, validateModelOverride, validateUsageReserve } from '../settings/validation.js';

export interface HostAgentDefaults {
  defaultProvider?: AgentProviderId;
  claudeModel?: string;
  codexModel?: string;
  primaryAgentModel?: string;
  claudeTimeoutMs: number;
  usageReserve: number;
}

export interface SettingsServiceDependencies {
  settings: SettingsRepository;
  projects: ProjectRepository;
  projectSettings: ProjectSettingsRepository;
  hostDefaults: HostAgentDefaults;
  isProviderAvailable: (provider: AgentProviderId) => boolean;
  checkProviderAvailability?: (provider: AgentProviderId) => Promise<{ available: boolean; reason?: string }>;
  mcpProfileCatalog: McpProfileCatalog;
  transaction: <T>(operation: () => T) => T;
}

export interface SettingsService {
  global(): GlobalAgentSettings;
  project(projectName: string): ProjectAgentSettings;
  updateGlobal(input: Partial<GlobalAgentSettings>): GlobalAgentSettings;
  updateGlobalWithActivation(input: Partial<GlobalAgentSettings>, activate: () => Promise<void>, rollbackActivation?: () => Promise<void> | void): Promise<GlobalAgentSettings>;
  updateProject(projectName: string, input: Partial<ProjectAgentSettingsUpdate>): ProjectAgentSettings;
  resolveTaskSettings(input: {
    projectName: string;
    provider: AgentProviderId;
    modelOverride?: string;
    reasoningOverride?: ReasoningEffort;
  }): AgentTaskSettings;
  mcpProfiles(): McpProfileCatalog;
}

export function createSettingsService(dependencies: SettingsServiceDependencies): SettingsService {
  const { settings, projects, projectSettings, hostDefaults, isProviderAvailable } = dependencies;
  const { transaction } = dependencies;
  const profileNames = Object.freeze([...dependencies.mcpProfileCatalog.profiles]);

  validateClaudeTimeout(hostDefaults.claudeTimeoutMs);
  validateUsageReserve(hostDefaults.usageReserve);

  function requireProviderAvailable(provider: AgentProviderId): void {
    if (!isProviderAvailable(provider)) throw new Error(`Provider ${provider} is not available on this host.`);
  }

  function global(): GlobalAgentSettings {
    const result: GlobalAgentSettings = {};
    const defaultProvider = settings.getDefaultProvider();
    const claudeModel = settings.getDefaultModel('claude');
    const codexModel = settings.getDefaultModel('codex');
    const primaryAgentModel = settings.getPrimaryAgentModel();
    const claudeTimeoutMs = settings.getClaudeTimeoutMs();
    const usageReserve = settings.getUsageReserve();
    const reasoningEfforts: Partial<Record<AgentProviderId, ReasoningEffort>> = {};
    for (const provider of ['claude', 'codex'] as const) {
      const effort = settings.getReasoningEffort(provider);
      if (effort) reasoningEfforts[provider] = effort;
    }
    if (defaultProvider) result.defaultProvider = defaultProvider;
    if (claudeModel) result.claudeModel = claudeModel;
    if (codexModel) result.codexModel = codexModel;
    if (primaryAgentModel) result.primaryAgentModel = primaryAgentModel;
    if (claudeTimeoutMs !== undefined) result.claudeTimeoutMs = claudeTimeoutMs;
    if (usageReserve !== undefined) result.usageReserve = usageReserve;
    if (Object.keys(reasoningEfforts).length > 0) result.reasoningEfforts = reasoningEfforts;
    return result;
  }

  function project(projectName: string): ProjectAgentSettings {
    const current = projects.findByName(projectName);
    if (!current) throw new Error(`Project "${projectName}" not found`);
    const extra = projectSettings.list(projectName);
    return {
      defaultProvider: current.defaultProvider,
      ...(current.models?.claude ? { claudeModel: current.models.claude } : {}),
      ...(current.models?.codex ? { codexModel: current.models.codex } : {}),
      ...(current.reasoningEfforts ? { reasoningEfforts: current.reasoningEfforts } : {}),
      ...(current.baseBranch ? { baseBranch: current.baseBranch } : {}),
      ...(current.roborevChannelId ? { roborevChannelId: current.roborevChannelId } : {}),
      ...(extra.mcpProfile ? { mcpProfile: extra.mcpProfile } : {}),
    };
  }

  function updateGlobal(input: Partial<GlobalAgentSettings>): GlobalAgentSettings {
    const defaultProvider = input.defaultProvider;
    const claudeModel = input.claudeModel === undefined ? undefined : validateModelOverride(input.claudeModel);
    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);
    const primaryAgentModel = input.primaryAgentModel === undefined ? undefined : validateModelOverride(input.primaryAgentModel);
    const claudeTimeoutMs = input.claudeTimeoutMs === undefined ? undefined : validateClaudeTimeout(input.claudeTimeoutMs);
    const usageReserve = input.usageReserve === undefined ? undefined : validateUsageReserve(input.usageReserve);
    if (defaultProvider !== undefined) requireProviderAvailable(defaultProvider);
    if (input.reasoningEfforts !== undefined) {
      for (const provider of ['claude', 'codex'] as const) {
        if (Object.prototype.hasOwnProperty.call(input.reasoningEfforts, provider)
          && input.reasoningEfforts[provider] !== undefined) {
          validateSupportedAgentSettings(provider, { reasoningEffort: input.reasoningEfforts[provider] }, 'task');
        }
      }
    }
    transaction(() => {
      if (Object.prototype.hasOwnProperty.call(input, 'defaultProvider')) {
        if (defaultProvider === undefined) settings.clearDefaultProvider();
        else settings.setDefaultProvider(defaultProvider);
      }
      if (input.claudeModel !== undefined) settings.setDefaultModel('claude', claudeModel);
      if (input.codexModel !== undefined) settings.setDefaultModel('codex', codexModel);
      if (input.primaryAgentModel !== undefined) settings.setPrimaryAgentModel(primaryAgentModel);
      if (Object.prototype.hasOwnProperty.call(input, 'claudeTimeoutMs')) settings.setClaudeTimeoutMs(claudeTimeoutMs);
      if (Object.prototype.hasOwnProperty.call(input, 'usageReserve')) settings.setUsageReserve(usageReserve);
      if (input.reasoningEfforts !== undefined) {
        for (const provider of ['claude', 'codex'] as const) {
          if (Object.prototype.hasOwnProperty.call(input.reasoningEfforts, provider)) {
            settings.setReasoningEffort(provider, input.reasoningEfforts[provider]);
          }
        }
      }
    });
    return global();
  }

  async function updateGlobalWithActivation(input: Partial<GlobalAgentSettings>, activate: () => Promise<void>, rollbackActivation?: () => Promise<void> | void): Promise<GlobalAgentSettings> {
    const before = global();
    if (input.defaultProvider !== undefined && dependencies.checkProviderAvailability) {
      const availability = await dependencies.checkProviderAvailability(input.defaultProvider);
      if (!availability.available) throw new Error(availability.reason ?? `Provider ${input.defaultProvider} is unavailable on this host.`);
    }
    updateGlobal(input);
    try {
      await activate();
      return global();
    } catch (error) {
      transaction(() => {
        if (before.defaultProvider) settings.setDefaultProvider(before.defaultProvider);
        else settings.clearDefaultProvider();
        settings.setDefaultModel('claude', before.claudeModel);
        settings.setDefaultModel('codex', before.codexModel);
        settings.setPrimaryAgentModel(before.primaryAgentModel);
        settings.setClaudeTimeoutMs(before.claudeTimeoutMs);
        settings.setUsageReserve(before.usageReserve);
        settings.setReasoningEffort('claude', before.reasoningEfforts?.claude);
        settings.setReasoningEffort('codex', before.reasoningEfforts?.codex);
      });
      try {
        await rollbackActivation?.();
      } catch (rollbackError) {
        console.warn('[settings] PM activation rollback failed:', redactErrorMessage(rollbackError));
      }
      throw error;
    }
  }

  function updateProject(projectName: string, input: Partial<ProjectAgentSettingsUpdate>): ProjectAgentSettings {
    const current = projects.findByName(projectName);
    if (!current) throw new Error(`Project "${projectName}" not found`);
    if (Object.prototype.hasOwnProperty.call(input, 'roborevChannelId')) {
      throw new Error('Roborev channel identity is managed by the channel lifecycle, not settings.');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'roborevEnabled')) {
      throw new Error('Roborev enabled state is managed by the channel lifecycle, not settings.');
    }
    const claudeModel = input.claudeModel === undefined ? undefined : validateModelOverride(input.claudeModel);
    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);
    const mcpProfile = input.mcpProfile === undefined || input.mcpProfile === null
      ? input.mcpProfile
      : validateMcpProfile(input.mcpProfile, profileNames);
    const baseBranch = input.baseBranch === undefined ? undefined : validateBaseBranch(input.baseBranch);
    if (input.defaultProvider !== undefined) requireProviderAvailable(input.defaultProvider);
    if (input.reasoningEfforts !== undefined) {
      for (const provider of ['claude', 'codex'] as const) {
        if (Object.prototype.hasOwnProperty.call(input.reasoningEfforts, provider)
          && input.reasoningEfforts[provider] !== undefined) {
          validateSupportedAgentSettings(provider, { reasoningEffort: input.reasoningEfforts[provider] }, 'task');
        }
      }
    }
    transaction(() => {
      if (input.defaultProvider !== undefined) projects.updateDefaultProvider(projectName, input.defaultProvider);
      if (input.claudeModel !== undefined) projects.updateModel(projectName, 'claude', claudeModel);
      if (input.codexModel !== undefined) projects.updateModel(projectName, 'codex', codexModel);
      if (input.reasoningEfforts !== undefined) {
        for (const provider of ['claude', 'codex'] as const) {
          if (Object.prototype.hasOwnProperty.call(input.reasoningEfforts, provider)) {
            projects.updateReasoning(projectName, provider, input.reasoningEfforts[provider]);
          }
        }
      }
      if (baseBranch !== undefined) projects.updateBaseBranch(projectName, baseBranch);
      if (input.mcpProfile !== undefined) {
        if (mcpProfile === null) projectSettings.clear(projectName, 'mcpProfile');
        else projectSettings.set(projectName, 'mcpProfile', mcpProfile);
      }
    });
    return project(projectName);
  }

  function resolveTaskSettings(input: {
    projectName: string;
    provider: AgentProviderId;
    modelOverride?: string;
    reasoningOverride?: ReasoningEffort;
  }): AgentTaskSettings {
    if (input.provider === 'claude' && input.reasoningOverride !== undefined) {
      throw new Error('Claude does not support agent setting reasoningEffort');
    }
    const projectRecord = projects.findByName(input.projectName);
    if (!projectRecord) throw new Error(`Project "${input.projectName}" not found`);
    const globalSettings = global();
    const projectSettingsValue = project(input.projectName);
    const providerModel = input.provider === 'claude' ? 'claudeModel' : 'codexModel';
    const hostModel = input.provider === 'claude' ? hostDefaults.claudeModel : hostDefaults.codexModel;
    const model = validateModelOverride(input.modelOverride)
      ?? projectSettingsValue[providerModel]
      ?? globalSettings[providerModel]
      ?? hostModel;
    const reasoning = input.provider === 'codex'
      ? input.reasoningOverride ?? projectRecord.reasoningEfforts?.[input.provider]
      : undefined;
    const result: AgentTaskSettings = {};
    if (model) result.model = model;
    if (reasoning) result.reasoningEffort = reasoning;
    if (input.provider === 'claude') {
      result.timeoutMs = globalSettings.claudeTimeoutMs ?? hostDefaults.claudeTimeoutMs;
      if (projectSettingsValue.mcpProfile) result.mcpProfile = projectSettingsValue.mcpProfile;
    }
    return result;
  }

  return {
    global,
    project,
    updateGlobal,
    updateGlobalWithActivation,
    updateProject,
    resolveTaskSettings,
    mcpProfiles: () => Object.freeze({ profiles: Object.freeze([...profileNames]) }),
  };
}

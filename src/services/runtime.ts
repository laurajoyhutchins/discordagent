import type { Client } from 'discord.js';
import type { AgentProvider, AgentProviderId } from '../agents/contracts.js';
import type { AppServerTransport } from '../agents/codex/appServerTransport.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import { config } from '../config.js';
import { createTaskCapabilityPreflight } from '../coordinator/capabilityPreflight.js';
import { createTaskCoordinator, type TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { DatabaseHandle } from '../db/database.js';
import { evaluateCapability, type CapabilityPermissionChannel } from '../discord/capabilities/evaluator.js';
import { PROCESS_GATEWAY_INTENTS } from '../discord/capabilities/registry.js';
import { DiscordInteractionBroker } from '../discord/interactionBroker.js';
import { DiscordTaskRenderer, type TaskRenderer } from '../discord/taskRenderer.js';
import { createGitClient, type GitClient } from '../git/gitClient.js';
import { createWorktreeManager, type WorktreeManager } from '../git/worktreeManager.js';
import type { PrimaryModel } from '../primary/primaryModel.js';
import type { PrimaryAgentService } from '../primary/primaryAgentService.js';
import type { PrimaryConversationService } from '../primary/primaryConversationService.js';
import { createEventRepository, type EventRepository } from '../repositories/eventRepository.js';
import { createMemoryRepository, type MemoryRepository } from '../repositories/memoryRepository.js';
import { createMessageRepository, type MessageRepository } from '../repositories/messageRepository.js';
import { createProjectSettingsRepository } from '../repositories/projectSettingsRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/taskRepository.js';
import { createUsageRepository } from '../repositories/usageRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';
import {
  clearAgentRuntimeServices,
  setAgentRuntimeServices,
} from './agentRuntimeService.js';
import { clearPrimaryAgentService } from './primaryAgentServiceRegistry.js';
import { createPendingTaskService, type PendingTaskService } from './pendingTaskService.js';
import {
  closeProjectStore,
  getProjectDatabase,
  getProjectRepository,
  getSettingsRepository,
  initializeProjectStore,
} from './projectStore.js';
import type { ProviderOnboardingService } from './providerOnboarding.js';
import { recoverRuntime } from './runtimeRecovery.js';
import { RuntimeLifecycle } from './runtimeLifecycle.js';
import {
  bootstrapPrimaryAgent,
  configuredPrimaryModelForProvider,
  resolvePrimaryAgentModel,
} from './runtimePrimaryAgent.js';
import {
  bootstrapProviders,
  createHostMcpProfiles,
} from './runtimeProviders.js';
import { startUsageMonitoring } from './runtimeUsage.js';
import { createSettingsService, type SettingsService } from './settingsService.js';
import {
  clearTaskCoordinator,
  setTaskCoordinator,
} from './taskCoordinatorService.js';
import { createUsageAdmissionService, type UsageAdmissionService } from './usageAdmission.js';
import {
  clearUsageAdmissionService,
  setUsageAdmissionService,
} from './usageAdmissionRegistry.js';
import { initUsageTracker } from './usageTracker.js';

export {
  configuredPrimaryModelForProvider,
  createHostMcpProfiles,
  resolvePrimaryAgentModel,
};

export interface RuntimeComponentFactories {
  providers: typeof bootstrapProviders;
  primaryAgent: typeof bootstrapPrimaryAgent;
  usage: typeof startUsageMonitoring;
  recovery: typeof recoverRuntime;
}

export interface RuntimeOptions {
  databasePath?: string;
  legacyPath?: string;
  worktreesBaseDir?: string;
  git?: GitClient;
  claudeProvider?: AgentProvider;
  codexProvider?: AgentProvider;
  openCodeProvider?: AgentProvider;
  disableClaude?: boolean;
  codexTransport?: AppServerTransport;
  codexAuth?: CodexAuthService;
  disableCodex?: boolean;
  disableOpenCode?: boolean;
  primaryModel?: PrimaryModel;
  primaryModelFactory?: (provider: AgentProviderId) => PrimaryModel | undefined;
  disablePrimaryAgent?: boolean;
  headlessPrimaryAgent?: boolean;
  primaryProvider?: AgentProviderId;
  disableUsagePolling?: boolean;
  components?: Partial<RuntimeComponentFactories>;
}

export interface RuntimeServices {
  database: DatabaseHandle;
  projects: ProjectRepository;
  settings: SettingsRepository;
  settingsService: SettingsService;
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  coordinator: TaskCoordinator;
  renderers: Set<TaskRenderer>;
  codexTransport?: AppServerTransport;
  codexAuth?: CodexAuthService;
  messages: MessageRepository;
  memories: MemoryRepository;
  primaryAgent?: PrimaryAgentService;
  conversationService?: PrimaryConversationService;
  usage: UsageAdmissionService;
  pendingTasks: PendingTaskService;
  providerOnboarding?: ProviderOnboardingService;
  usagePoll?: ReturnType<typeof setInterval>;
  usageUnsubscribe?: () => void;
  lifecycle: RuntimeLifecycle;
}

const defaultComponents: RuntimeComponentFactories = {
  providers: bootstrapProviders,
  primaryAgent: bootstrapPrimaryAgent,
  usage: startUsageMonitoring,
  recovery: recoverRuntime,
};

export async function startRuntime(
  client: Client,
  options: RuntimeOptions = {},
): Promise<RuntimeServices> {
  resetRuntimeRegistries();
  const lifecycle = new RuntimeLifecycle({
    onError: ({ owner, error }) => {
      console.warn(`[runtime] Failed to stop ${owner}:`, redactErrorMessage(error));
    },
  });
  const components = { ...defaultComponents, ...options.components };

  try {
    initializeProjectStore({
      databasePath: options.databasePath ?? config.databasePath,
      ...(options.legacyPath ? { legacyPath: options.legacyPath } : {}),
    });
    lifecycle.defer('project store', () => closeProjectStore());

    const database = getProjectDatabase();
    const projects = getProjectRepository();
    const settings = getSettingsRepository();
    const projectSettings = createProjectSettingsRepository(database);
    const tasks = createTaskRepository(database);
    const events = createEventRepository(database);
    const messages = createMessageRepository(database);
    const memories = createMemoryRepository(database);
    const usage = createUsageAdmissionService(createUsageRepository(database), {
      primaryReserve: () => settings.getUsageReserve() ?? config.primaryUsageReserve,
    });

    const capabilityContext = (channel: CapabilityPermissionChannel) => {
      const channelGuild = (
        channel as CapabilityPermissionChannel & {
          guild?: { members: { me: import('discord.js').GuildMember | null } };
        }
      ).guild;
      const guild = channelGuild ?? client.guilds.cache.get(config.guildId);
      return {
        member: guild?.members.me ?? null,
        channel,
        configuredIntents: PROCESS_GATEWAY_INTENTS,
      };
    };
    const capabilityPreflight = createTaskCapabilityPreflight(capabilityContext);
    const runtimeRenderers = new Set<TaskRenderer>();
    const rendererFactory = (thread: import('discord.js').AnyThreadChannel) => {
      const renderer = new DiscordTaskRenderer({
        notifyUserId: config.notifyUserId,
        controlCardStore: tasks,
        controlCardCanEmbed: target => evaluateCapability(
          'core.message.embed',
          capabilityContext(target as unknown as CapabilityPermissionChannel),
        ).state === 'available',
        controlCardCanPin: target => evaluateCapability(
          'task.control-card.pin',
          capabilityContext(target as unknown as CapabilityPermissionChannel),
        ).state === 'available',
      });
      runtimeRenderers.add(renderer);
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = async () => {
        runtimeRenderers.delete(renderer);
        await dispose();
      };
      return renderer;
    };
    lifecycle.defer('task renderers', async () => {
      await Promise.all([...runtimeRenderers].map(renderer => Promise.resolve(renderer.dispose?.())));
    });

    const worktrees = createWorktreeManager({
      baseDirectory: options.worktreesBaseDir ?? config.worktreesBaseDir,
      git: options.git ?? createGitClient(),
    });

    const providerRuntime = await components.providers({
      usage,
      ...(options.claudeProvider ? { claudeProvider: options.claudeProvider } : {}),
      ...(options.codexProvider ? { codexProvider: options.codexProvider } : {}),
      ...(options.openCodeProvider ? { openCodeProvider: options.openCodeProvider } : {}),
      ...(options.codexTransport ? { codexTransport: options.codexTransport } : {}),
      ...(options.codexAuth ? { codexAuth: options.codexAuth } : {}),
      ...(options.disableClaude !== undefined ? { disableClaude: options.disableClaude } : {}),
      ...(options.disableCodex !== undefined ? { disableCodex: options.disableCodex } : {}),
      ...(options.disableOpenCode !== undefined ? { disableOpenCode: options.disableOpenCode } : {}),
    });
    lifecycle.defer('provider bootstrap', () => providerRuntime.stop());

    const settingsService = createSettingsService({
      settings,
      projects,
      projectSettings,
      hostDefaults: {
        defaultProvider: undefined,
        claudeModel: config.defaultModel || undefined,
        codexModel: config.defaultCodexModel || undefined,
        openCodeModel: config.defaultOpenCodeModel || undefined,
        primaryAgentModel: config.primaryAgentModel || undefined,
        claudeTimeoutMs: config.claudeTimeoutMs,
        usageReserve: config.primaryUsageReserve,
      },
      isProviderAvailable: provider => providerRuntime.providers.list().includes(provider),
      checkProviderAvailability: async provider => providerRuntime.providers.require(provider).checkAvailability(),
      mcpProfileCatalog: { profiles: providerRuntime.mcpProfiles.profiles },
      transaction: operation => database.raw.transaction(operation)(),
    });

    const coordinator = createTaskCoordinator({
      projects,
      tasks,
      settings: settingsService,
      events,
      worktrees,
      providers: providerRuntime.providers,
      usage,
      capabilityPreflight,
      rendererFactory,
      brokerFactory: () => new DiscordInteractionBroker(),
    });
    lifecycle.defer('task coordinator', () => coordinator.shutdown());

    const pendingTasks = createPendingTaskService(coordinator);
    initUsageTracker(client);
    setTaskCoordinator(coordinator);
    setAgentRuntimeServices({
      providers: providerRuntime.providers,
      tasks,
      pendingTasks,
      settingsService,
      ...(providerRuntime.codexAuth ? { codexAuth: providerRuntime.codexAuth } : {}),
    });
    setUsageAdmissionService(usage);
    lifecycle.defer('runtime service registries', () => resetRuntimeRegistries());

    const primaryRuntime = await components.primaryAgent({
      client,
      providers: providerRuntime.providers,
      projects,
      settings,
      settingsService,
      tasks,
      messages,
      memories,
      usage,
      coordinator,
      pendingTasks,
      ...(providerRuntime.codexTransport ? { codexTransport: providerRuntime.codexTransport } : {}),
      ...(providerRuntime.codexAuth ? { codexAuth: providerRuntime.codexAuth } : {}),
      ...(options.primaryModel ? { primaryModel: options.primaryModel } : {}),
      ...(options.primaryModelFactory ? { primaryModelFactory: options.primaryModelFactory } : {}),
      ...(options.disablePrimaryAgent !== undefined ? { disablePrimaryAgent: options.disablePrimaryAgent } : {}),
      ...(options.headlessPrimaryAgent !== undefined ? { headlessPrimaryAgent: options.headlessPrimaryAgent } : {}),
      ...(options.primaryProvider ? { primaryProvider: options.primaryProvider } : {}),
    });
    lifecycle.defer('primary agent bootstrap', () => primaryRuntime.stop());

    const usageRuntime = await components.usage({
      usage,
      ...(providerRuntime.codexAuth ? { codexAuth: providerRuntime.codexAuth } : {}),
      ...(options.disableUsagePolling !== undefined
        ? { disableUsagePolling: options.disableUsagePolling }
        : {}),
    });
    lifecycle.defer('usage monitoring', () => usageRuntime.stop());

    const recoveryRuntime = await components.recovery({
      client,
      coordinator,
      events,
      tasks,
      usage,
      rendererFactory,
      ...(options.headlessPrimaryAgent !== undefined
        ? { headlessPrimaryAgent: options.headlessPrimaryAgent }
        : {}),
    });
    lifecycle.defer('recovery rendering', () => recoveryRuntime.stop());

    return {
      database,
      projects,
      settings,
      settingsService,
      tasks,
      events,
      messages,
      memories,
      worktrees,
      providers: providerRuntime.providers,
      coordinator,
      renderers: runtimeRenderers,
      usage,
      pendingTasks,
      lifecycle,
      ...(primaryRuntime.providerOnboarding
        ? { providerOnboarding: primaryRuntime.providerOnboarding }
        : {}),
      ...(usageRuntime.usagePoll ? { usagePoll: usageRuntime.usagePoll } : {}),
      ...(usageRuntime.usageUnsubscribe
        ? { usageUnsubscribe: usageRuntime.usageUnsubscribe }
        : {}),
      ...(primaryRuntime.primaryAgent ? { primaryAgent: primaryRuntime.primaryAgent } : {}),
      ...(primaryRuntime.conversationService
        ? { conversationService: primaryRuntime.conversationService }
        : {}),
      ...(providerRuntime.codexTransport
        ? { codexTransport: providerRuntime.codexTransport }
        : {}),
      ...(providerRuntime.codexAuth ? { codexAuth: providerRuntime.codexAuth } : {}),
    };
  } catch (error) {
    await lifecycle.stop();
    throw error;
  }
}

export async function stopRuntime(runtime: RuntimeServices): Promise<void> {
  await runtime.lifecycle.stop();
}

function resetRuntimeRegistries(): void {
  clearTaskCoordinator();
  clearAgentRuntimeServices();
  clearPrimaryAgentService();
  clearUsageAdmissionService();
}

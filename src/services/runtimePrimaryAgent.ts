import type { Client, TextChannel } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import { ClaudePrimaryModel } from '../agents/claude/claudePrimaryModel.js';
import type { AppServerTransport } from '../agents/codex/appServerTransport.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import { CodexPrimaryModel } from '../agents/codex/codexPrimaryModel.js';
import { OpenCodePrimaryModel } from '../agents/opencode/opencodePrimaryModel.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import { config } from '../config.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { createContextAssembler } from '../primary/contextAssembler.js';
import { createPrimaryAgentService, type PrimaryAgentService } from '../primary/primaryAgentService.js';
import {
  createDelegatingConversationService,
  createPrimaryConversationService,
  type PrimaryConversationService,
} from '../primary/primaryConversationService.js';
import type { PrimaryModel, PrimaryTaskProposal } from '../primary/primaryModel.js';
import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import { capturePrimaryProviderState, setAgentRuntimeServices, type PrimaryProviderActivationResult } from './agentRuntimeService.js';
import { ensurePrimaryAgentChannel } from './channelManager.js';
import type { PendingTaskService } from './pendingTaskService.js';
import { createProviderOnboardingService, type ProviderOnboardingService } from './providerOnboarding.js';
import { clearPrimaryAgentService, setPrimaryAgentService } from './primaryAgentServiceRegistry.js';
import type { SettingsService } from './settingsService.js';
import type { UsageAdmissionService } from './usageAdmission.js';

export function resolvePrimaryAgentModel(input: {
  persistedPrimaryModel?: string;
  configuredProviderModel?: string;
  configuredPrimaryModel?: string;
  providerDefaultModel?: string;
}): string | undefined {
  return input.persistedPrimaryModel
    ?? input.configuredProviderModel
    ?? input.configuredPrimaryModel
    ?? input.providerDefaultModel;
}

export function configuredPrimaryModelForProvider(input: {
  provider: AgentProviderId;
  primaryAgentModel?: string;
  openCodePrimaryModel?: string;
}): string | undefined {
  if (input.provider === 'opencode') {
    return input.openCodePrimaryModel || input.primaryAgentModel || undefined;
  }
  return input.primaryAgentModel || undefined;
}

export interface PrimaryAgentBootstrapOptions {
  client: Client;
  providers: ProviderRegistry;
  projects: ProjectRepository;
  settings: SettingsRepository;
  settingsService: SettingsService;
  tasks: TaskRepository;
  messages: MessageRepository;
  memories: MemoryRepository;
  usage: UsageAdmissionService;
  coordinator: TaskCoordinator;
  pendingTasks: PendingTaskService;
  codexTransport?: AppServerTransport;
  codexAuth?: CodexAuthService;
  primaryModel?: PrimaryModel;
  primaryModelFactory?: (provider: AgentProviderId) => PrimaryModel | undefined;
  disablePrimaryAgent?: boolean;
  headlessPrimaryAgent?: boolean;
  primaryProvider?: AgentProviderId;
}

export interface PrimaryAgentBootstrapResult {
  conversationService: PrimaryConversationService;
  primaryAgent?: PrimaryAgentService;
  providerOnboarding?: ProviderOnboardingService;
  primaryProviderActivator?: (provider: AgentProviderId) => Promise<PrimaryProviderActivationResult>;
  stop(): Promise<void>;
}

export async function bootstrapPrimaryAgent(
  options: PrimaryAgentBootstrapOptions,
): Promise<PrimaryAgentBootstrapResult> {
  let primaryAgent: PrimaryAgentService | undefined;
  let providerOnboarding: ProviderOnboardingService | undefined;
  let primaryProviderActivator: ((provider: AgentProviderId) => Promise<PrimaryProviderActivationResult>) | undefined;
  const delegatingConversationService = createDelegatingConversationService();
  const conversationService = delegatingConversationService.service;
  const selectedProvider = options.headlessPrimaryAgent
    ? options.primaryProvider
    : options.settings.getDefaultProvider();

  try {
    if (!options.disablePrimaryAgent && (options.headlessPrimaryAgent || config.authorizedUserId)) {
      seedPolicyMemories(options.memories);
      let primaryChannel: TextChannel | undefined;
      if (!options.headlessPrimaryAgent) {
        const guild = await options.client.guilds.fetch(config.guildId);
        const configuredPrimaryChannelId = options.settings.get('primary_channel_id');
        primaryChannel = await ensurePrimaryAgentChannel(
          guild,
          config.authorizedRoleIds,
          config.authorizedUserId,
          configuredPrimaryChannelId,
        );
        if (configuredPrimaryChannelId !== primaryChannel.id) {
          options.settings.set('primary_channel_id', primaryChannel.id);
        }
      }

      const context = createContextAssembler({
        projects: options.projects,
        tasks: options.tasks,
        messages: options.messages,
        memories: options.memories,
        usage: options.usage,
      });
      const createPrimaryModel = (provider: AgentProviderId): PrimaryModel | undefined => {
        if (options.primaryModelFactory) return options.primaryModelFactory(provider);
        if (options.primaryModel) return options.primaryModel;
        const globalSettings = options.settingsService.global();
        const configuredModel = provider === 'claude'
          ? globalSettings.claudeModel
          : provider === 'codex'
            ? globalSettings.codexModel
            : globalSettings.openCodeModel;
        const configuredReasoning = options.settings.getReasoningEffort(provider);
        const primaryAgentModel = resolvePrimaryAgentModel({
          persistedPrimaryModel: globalSettings.primaryAgentModel,
          configuredProviderModel: configuredModel,
          configuredPrimaryModel: configuredPrimaryModelForProvider({
            provider,
            primaryAgentModel: config.primaryAgentModel,
            openCodePrimaryModel: config.openCodePrimaryModel,
          }),
          providerDefaultModel: (provider === 'claude'
            ? config.defaultModel
            : provider === 'codex'
              ? config.defaultCodexModel
              : config.defaultOpenCodeModel) || undefined,
        });
        if (provider === 'claude' && options.providers.list().includes('claude')) {
          return new ClaudePrimaryModel({ model: primaryAgentModel });
        }
        if (provider === 'codex' && options.codexTransport && options.codexAuth) {
          return new CodexPrimaryModel({
            transport: options.codexTransport,
            auth: options.codexAuth,
            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),
            ...(configuredReasoning ? { reasoningEffort: configuredReasoning } : {}),
          });
        }
        if (provider === 'opencode' && options.providers.list().includes('opencode')) {
          return new OpenCodePrimaryModel({
            cliPath: config.openCodeCliPath,
            timeoutMs: config.openCodeTimeoutMs,
            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),
          });
        }
        return undefined;
      };
      const fetchProjectChannel = async (id: string): Promise<TextChannel | null> => {
        if (options.headlessPrimaryAgent) return null;
        const channel = await options.client.channels.fetch(id).catch(() => null);
        return channel?.isTextBased() && !channel.isDMBased() && !channel.isThread()
          ? channel as TextChannel
          : null;
      };
      const sharedLaunchTask = async (proposal: PrimaryTaskProposal): Promise<void> => {
        if (options.headlessPrimaryAgent) {
          throw new Error('Task launch is unavailable in headless primary-agent mode.');
        }
        const project = options.projects.findByName(proposal.projectName);
        if (!project) throw new Error(`Project "${proposal.projectName}" is not registered`);
        const channel = await fetchProjectChannel(project.agentChannelId);
        if (!channel) throw new Error(`Project channel for "${proposal.projectName}" is unavailable`);
        const seed = await channel.send(`Delegated by the primary agent: ${proposal.objective}`);
        await options.coordinator.startFromMessage({
          projectName: project.name,
          prompt: proposal.objective,
          message: seed,
          provider: proposal.provider ?? project.defaultProvider,
        });
      };
      let activePrimaryProvider: AgentProviderId | undefined;
      const activatePrimaryProvider = async (
        provider: AgentProviderId,
      ): Promise<PrimaryProviderActivationResult> => {
        const wasActive = activePrimaryProvider !== undefined;
        const model = createPrimaryModel(provider);
        if (!model) throw new Error(`Provider ${provider} is not available for the PM chat on this host.`);
        const realService = createPrimaryConversationService({
          context,
          messages: options.messages,
          memories: options.memories,
          projects: options.projects,
          coordinator: options.coordinator,
          model,
          launchTask: sharedLaunchTask,
        });
        delegatingConversationService.setTarget(realService);
        activePrimaryProvider = provider;
        if (!options.headlessPrimaryAgent && !primaryAgent) {
          primaryAgent = createPrimaryAgentService({
            channelId: primaryChannel!.id,
            ownerId: config.authorizedUserId!,
            conversationService,
            model,
            context,
            messages: options.messages,
            memories: options.memories,
            projects: options.projects,
            coordinator: options.coordinator,
            fetchProjectChannel,
          });
          setPrimaryAgentService(primaryAgent);
        }
        return wasActive ? 'reconfigured' : 'activated';
      };
      primaryProviderActivator = activatePrimaryProvider;

      if (options.headlessPrimaryAgent) {
        if (!selectedProvider) {
          throw new Error('Headless primary-agent mode requires a primaryProvider.');
        }
        const selected = options.providers.list().includes(selectedProvider)
          ? options.providers.require(selectedProvider)
          : undefined;
        const availability = selected
          ? await selected.checkAvailability()
          : { available: false, reason: `Provider "${selectedProvider}" is not registered on this host.` };
        if (!selected || !availability.available) {
          throw new Error(availability.reason ?? `Provider "${selectedProvider}" is unavailable on this host.`);
        }
        await activatePrimaryProvider(selectedProvider);
      } else {
        providerOnboarding = createProviderOnboardingService({
          ownerId: config.authorizedUserId,
          settings: options.settingsService,
          metadata: options.settings,
          providers: options.providers,
          channel: primaryChannel!,
          botUserId: options.client.user?.id ?? '',
          onSelected: activatePrimaryProvider,
          captureSelectionState: capturePrimaryProviderState,
        });
        setAgentRuntimeServices({
          providers: options.providers,
          tasks: options.tasks,
          pendingTasks: options.pendingTasks,
          settingsService: options.settingsService,
          providerOnboarding,
          primaryProviderActivator,
          primaryChannelId: primaryChannel!.id,
          primaryOwnerId: config.authorizedUserId,
          ...(options.codexAuth ? { codexAuth: options.codexAuth } : {}),
        });
        if (!selectedProvider) {
          await providerOnboarding.ensurePrompt();
        } else {
          const selected = options.providers.list().includes(selectedProvider)
            ? options.providers.require(selectedProvider)
            : undefined;
          const availability = selected
            ? await selected.checkAvailability()
            : { available: false, reason: `Persisted provider "${selectedProvider}" is not registered on this host.` };
          if (!selected || !availability.available) {
            await providerOnboarding.ensurePrompt({ forceSelection: true });
          } else {
            await activatePrimaryProvider(selectedProvider);
            await providerOnboarding.ensurePrompt();
          }
        }
      }
    }

    if (providerOnboarding || primaryProviderActivator) {
      setAgentRuntimeServices({
        providers: options.providers,
        tasks: options.tasks,
        pendingTasks: options.pendingTasks,
        settingsService: options.settingsService,
        ...(providerOnboarding ? { providerOnboarding } : {}),
        ...(primaryProviderActivator ? { primaryProviderActivator } : {}),
        ...(options.codexAuth ? { codexAuth: options.codexAuth } : {}),
      });
    }

    return {
      conversationService,
      ...(primaryAgent ? { primaryAgent } : {}),
      ...(providerOnboarding ? { providerOnboarding } : {}),
      ...(primaryProviderActivator ? { primaryProviderActivator } : {}),
      stop: async () => {
        clearPrimaryAgentService();
      },
    };
  } catch (error) {
    clearPrimaryAgentService();
    throw error;
  }
}

function seedPolicyMemories(memories: MemoryRepository): void {
  const defaults: Array<{ key: string; value: unknown }> = [
    {
      key: 'behavior',
      value: {
        guidance: 'Be concise and outcome-focused. You have no coding tools and must never pretend to execute work. Propose one bounded task per message when appropriate.',
      },
    },
    {
      key: 'task_proposal',
      value: {
        guidance: 'When the user describes work, propose a single small task with a clear objective. Use the task-proposal buttons (not /task). Let the user confirm before creating.',
      },
    },
    {
      key: 'decisions',
      value: {
        guidance: 'Use polls for group input. Use confirm for simple yes/no. Use select menus when there are clear options. Record the outcome as a decision memory.',
      },
    },
  ];
  for (const entry of defaults) {
    if (!memories.get('policy', entry.key)) {
      memories.put({
        namespace: 'policy',
        key: entry.key,
        value: entry.value,
        sourceType: 'system',
        confidence: 1,
        readOnly: true,
      });
    }
  }
}

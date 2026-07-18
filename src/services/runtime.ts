import type { AnyThreadChannel, Client } from 'discord.js';
import type { DatabaseHandle } from '../db/database.js';
import type { AgentProvider, AgentProviderId } from '../agents/contracts.js';
import { ClaudeProvider } from '../agents/claude/claudeProvider.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { createTaskCoordinator, type TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { createTaskCapabilityPreflight } from '../coordinator/capabilityPreflight.js';
import { evaluateCapability, type CapabilityPermissionChannel } from '../discord/capabilities/evaluator.js';
import { PROCESS_GATEWAY_INTENTS } from '../discord/capabilities/registry.js';
import { DiscordInteractionBroker } from '../discord/interactionBroker.js';
import { DiscordTaskRenderer } from '../discord/taskRenderer.js';
import type { TaskRenderer } from '../discord/taskRenderer.js';
import { createGitClient, type GitClient } from '../git/gitClient.js';
import { createWorktreeManager, type WorktreeManager } from '../git/worktreeManager.js';
import { createEventRepository, type EventRepository } from '../repositories/eventRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/taskRepository.js';
import { config } from '../config.js';
import {
  closeProjectStore,
  getProjectDatabase,
  getProjectRepository,
  getSettingsRepository,
  initializeProjectStore,
} from './projectStore.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import { initRoborevWatcher } from './roborevWatcher.js';
import {
  clearTaskCoordinator,
  setTaskCoordinator,
} from './taskCoordinatorService.js';
import { captureRateLimitEvent, captureSessionResult, initUsageTracker } from './usageTracker.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { AppServerTransport } from '../agents/codex/appServerTransport.js';
import { CodexAuthService } from '../agents/codex/codexAuthService.js';
import { CodexProvider } from '../agents/codex/codexProvider.js';
import { CodexPrimaryModel } from '../agents/codex/codexPrimaryModel.js';
import { OpenCodeAcpTransport } from '../agents/opencode/acpTransport.js';
import { OpenCodePrimaryModel } from '../agents/opencode/opencodePrimaryModel.js';
import { OpenCodeProvider } from '../agents/opencode/opencodeProvider.js';
import { capturePrimaryProviderState, clearAgentRuntimeServices, setAgentRuntimeServices, type PrimaryProviderActivationResult } from './agentRuntimeService.js';
import { createMessageRepository, type MessageRepository } from '../repositories/messageRepository.js';
import { createMemoryRepository, type MemoryRepository } from '../repositories/memoryRepository.js';
import { ClaudePrimaryModel } from '../agents/claude/claudePrimaryModel.js';
import type { PrimaryModel } from '../primary/primaryModel.js';
import { createContextAssembler } from '../primary/contextAssembler.js';
import { createPrimaryAgentService, type PrimaryAgentService } from '../primary/primaryAgentService.js';
import { ensurePrimaryAgentChannel } from './channelManager.js';
import { clearPrimaryAgentService, setPrimaryAgentService } from './primaryAgentServiceRegistry.js';
import { createUsageRepository } from '../repositories/usageRepository.js';
import { createUsageAdmissionService, type UsageAdmissionService } from './usageAdmission.js';
import { clearUsageAdmissionService, setUsageAdmissionService } from './usageAdmissionRegistry.js';
import { createPendingTaskService, type PendingTaskService } from './pendingTaskService.js';
import { createProviderOnboardingService, type ProviderOnboardingService } from './providerOnboarding.js';
import { createProjectSettingsRepository } from '../repositories/projectSettingsRepository.js';
import { createSettingsService, type SettingsService } from './settingsService.js';
import type { HostMcpServerConfig, HostMcpServers } from '../agents/contracts.js';

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
  disablePrimaryAgent?: boolean;
  disableUsagePolling?: boolean;
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
  usage: UsageAdmissionService;
  pendingTasks: PendingTaskService;
  providerOnboarding?: ProviderOnboardingService;
  usagePoll?: ReturnType<typeof setInterval>;
  usageUnsubscribe?: () => void;
}

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

export interface HostMcpProfiles {
  profiles: readonly string[];
  resolve(profile?: string): HostMcpServers | undefined;
}

export function createHostMcpProfiles(
  configuredServers?: HostMcpServers,
): HostMcpProfiles {
  const servers = configuredServers ?? {};
  const serverNames = Object.keys(servers).filter(name => name !== 'default' && name !== 'disabled');
  const filteredServers = Object.fromEntries(serverNames.map(name => [name, servers[name]])) as Record<string, HostMcpServerConfig>;
  const defaultServers = serverNames.length > 0 ? filteredServers : undefined;
  const profiles = ['default', 'disabled', ...serverNames];

  return {
    profiles,
    resolve(profile?: string): HostMcpServers | undefined {
      if (profile === undefined || profile === 'default') return defaultServers;
      if (profile === 'disabled') return {};
      if (!Object.prototype.hasOwnProperty.call(servers, profile)) return undefined;
      return { [profile]: filteredServers[profile] };
    },
  };
}

export async function startRuntime(
  client: Client,
  options: RuntimeOptions = {},
): Promise<RuntimeServices> {
  clearTaskCoordinator();
  clearAgentRuntimeServices();
  clearPrimaryAgentService();
  clearUsageAdmissionService();

  let codexTransport = options.codexTransport;
  let codexAuth = options.codexAuth;
  let codexProvider = options.codexProvider;
  let openCodeProvider = options.openCodeProvider;
  let usageUnsubscribe: (() => void) | undefined;

  try {
    initializeProjectStore({
      databasePath: options.databasePath ?? config.databasePath,
      ...(options.legacyPath ? { legacyPath: options.legacyPath } : {}),
    });

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
      const channelGuild = (channel as CapabilityPermissionChannel & { guild?: { members: { me: import('discord.js').GuildMember | null } } }).guild;
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
        controlCardCanEmbed: target => evaluateCapability('core.message.embed', capabilityContext(target as unknown as CapabilityPermissionChannel)).state === 'available',
        controlCardCanPin: target => evaluateCapability('task.control-card.pin', capabilityContext(target as unknown as CapabilityPermissionChannel)).state === 'available',
      });
      runtimeRenderers.add(renderer);
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = async () => {
        runtimeRenderers.delete(renderer);
        await dispose();
      };
      return renderer;
    };
    const worktrees = createWorktreeManager({
      baseDirectory: options.worktreesBaseDir ?? config.worktreesBaseDir,
      git: options.git ?? createGitClient(),
    });
    const providers = new ProviderRegistry();
    const mcpProfiles = createHostMcpProfiles(config.mcpServers);
    if (!options.disableClaude && config.claudeEnabled) {
      const claudeProvider = options.claudeProvider ?? new ClaudeProvider({
        resolveMcpServers: mcpProfiles.resolve,
        onRateLimit: info => {
          captureRateLimitEvent(info);
          const raw = typeof info.utilization === 'number' ? info.utilization : undefined;
          const utilization = raw === undefined ? undefined : raw <= 1 ? raw * 100 : raw;
          usage.recordWindow({
            provider: 'claude',
            windowType: typeof info.rateLimitType === 'string' ? info.rateLimitType : 'unknown',
            utilization,
            remaining: utilization === undefined ? undefined : Math.max(0, 100 - utilization),
            resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
            capturedAt: Date.now(),
            payload: info,
          });
        },
        onSessionResult: captureSessionResult,
      });
      if (claudeProvider.id !== 'claude') {
        throw new Error(`Runtime expected a Claude provider, received "${claudeProvider.id}"`);
      }
      providers.register(claudeProvider);
    }

    if (!codexProvider && !options.disableCodex && config.codexEnabled) {
      try {
        codexTransport ??= new AppServerTransport({ command: config.codexCliPath });
        await codexTransport.initialize();
        codexAuth ??= new CodexAuthService(codexTransport);
        codexProvider = new CodexProvider({ transport: codexTransport, auth: codexAuth });
      } catch (error) {
        console.warn('[runtime] Codex App Server unavailable:', redactErrorMessage(error));
        await codexTransport?.close().catch(() => undefined);
        codexTransport = undefined;
        codexAuth = undefined;
        codexProvider = undefined;
      }
    }
    if (codexProvider) {
      if (codexProvider.id !== 'codex') throw new Error(`Runtime expected a Codex provider, received "${codexProvider.id}"`);
      providers.register(codexProvider);
    }

    if (openCodeProvider && openCodeProvider.id !== 'opencode') {
      throw new Error(`Runtime expected an OpenCode provider, received "${openCodeProvider.id}"`);
    }
    if (!options.disableOpenCode) {
      if (!openCodeProvider && config.openCodeEnabled) {
        openCodeProvider = new OpenCodeProvider({
          cliPath: config.openCodeCliPath,
          timeoutMs: config.openCodeTimeoutMs,
          defaultModel: config.defaultOpenCodeModel || undefined,
          createConnection: handlers => Promise.resolve(new OpenCodeAcpTransport({
            cliPath: config.openCodeCliPath,
            handlers,
          })),
        });
      }
      if (openCodeProvider) {
        try {
          const availability = await openCodeProvider.checkAvailability();
          if (availability.available) providers.register(openCodeProvider);
          else console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(availability.reason ?? 'OpenCode provider is unavailable'));
        } catch (error) {
          console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(error));
        }
      }
    }

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
      isProviderAvailable: provider => providers.list().includes(provider),
      checkProviderAvailability: async provider => providers.require(provider).checkAvailability(),
      mcpProfileCatalog: { profiles: mcpProfiles.profiles },
      transaction: operation => database.raw.transaction(operation)(),
    });

    const coordinator = createTaskCoordinator({
      projects,
      tasks,
      settings: settingsService,
      events,
      worktrees,
      providers,
      usage,
      capabilityPreflight,
      rendererFactory,
      brokerFactory: () => new DiscordInteractionBroker(),
    });

    const pendingTasks = createPendingTaskService(coordinator);
    initUsageTracker(client);
    initRoborevWatcher(client);
    setTaskCoordinator(coordinator);
    let providerOnboarding: ProviderOnboardingService | undefined;
    setAgentRuntimeServices({ providers, tasks, pendingTasks, settingsService, ...(codexAuth ? { codexAuth } : {}) });
    setUsageAdmissionService(usage);
    let primaryAgent: PrimaryAgentService | undefined;
    let primaryProviderActivator: ((provider: AgentProviderId) => Promise<PrimaryProviderActivationResult>) | undefined;
    const selectedProvider = settings.getDefaultProvider();
    if (!options.disablePrimaryAgent && config.authorizedUserId) {
      const guild = await client.guilds.fetch(config.guildId);
      const configuredPrimaryChannelId = settings.get('primary_channel_id');
      const primaryChannel = await ensurePrimaryAgentChannel(guild, config.authorizedRoleIds, config.authorizedUserId, configuredPrimaryChannelId);
      if (configuredPrimaryChannelId !== primaryChannel.id) settings.set('primary_channel_id', primaryChannel.id);
      const context = createContextAssembler({ projects, tasks, messages, memories, usage });
      const createPrimaryModel = (provider: AgentProviderId): PrimaryModel | undefined => {
        if (options.primaryModel) return options.primaryModel;
        const globalSettings = settingsService.global();
        const configuredModel = provider === 'claude'
          ? globalSettings.claudeModel
          : provider === 'codex'
            ? globalSettings.codexModel
            : globalSettings.openCodeModel;
        const configuredReasoning = settings.getReasoningEffort(provider);
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
        if (provider === 'claude' && providers.list().includes('claude')) {
          return new ClaudePrimaryModel({ model: primaryAgentModel });
        }
        if (provider === 'codex' && codexTransport && codexAuth) {
          return new CodexPrimaryModel({
            transport: codexTransport,
            auth: codexAuth,
            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),
            ...(configuredReasoning ? { reasoningEffort: configuredReasoning } : {}),
          });
        }
        if (provider === 'opencode' && providers.list().includes('opencode')) {
          return new OpenCodePrimaryModel({
            cliPath: config.openCodeCliPath,
            timeoutMs: config.openCodeTimeoutMs,
            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),
          });
        }
        return undefined;
      };
      const activatePrimaryProvider = async (provider: AgentProviderId): Promise<PrimaryProviderActivationResult> => {
        const wasActive = primaryAgent !== undefined;
        const model = createPrimaryModel(provider);
        if (!model) throw new Error(`Provider ${provider} is not available for the PM chat on this host.`);
        primaryAgent = createPrimaryAgentService({
          channelId: primaryChannel.id, ownerId: config.authorizedUserId!,
          model,
          context, messages, memories, projects, coordinator,
          fetchProjectChannel: async id => { const channel = await client.channels.fetch(id).catch(() => null); return channel?.isTextBased() && !channel.isDMBased() && !channel.isThread() ? channel as import('discord.js').TextChannel : null; },
        });
        setPrimaryAgentService(primaryAgent);
        return wasActive ? 'reconfigured' : 'activated';
      };
      primaryProviderActivator = activatePrimaryProvider;
      providerOnboarding = createProviderOnboardingService({
        ownerId: config.authorizedUserId,
        settings: settingsService,
        metadata: settings,
        providers,
        channel: primaryChannel,
        botUserId: client.user?.id ?? '',
        onSelected: activatePrimaryProvider,
        captureSelectionState: capturePrimaryProviderState,
      });
      setAgentRuntimeServices({ providers, tasks, pendingTasks, settingsService, providerOnboarding, primaryProviderActivator, primaryChannelId: primaryChannel.id, primaryOwnerId: config.authorizedUserId, ...(codexAuth ? { codexAuth } : {}) });
      if (!selectedProvider) {
        await providerOnboarding.ensurePrompt();
      } else {
        const selected = providers.list().includes(selectedProvider) ? providers.require(selectedProvider) : undefined;
        const availability = selected ? await selected.checkAvailability() : { available: false, reason: `Persisted provider "${selectedProvider}" is not registered on this host.` };
        if (!selected || !availability.available) {
          await providerOnboarding.ensurePrompt({ forceSelection: true });
        } else {
          await activatePrimaryProvider(selectedProvider);
          await providerOnboarding.ensurePrompt();
        }
      }
    }
    if (providerOnboarding || primaryProviderActivator) {
      setAgentRuntimeServices({
        providers,
        tasks,
        pendingTasks,
        settingsService,
        ...(providerOnboarding ? { providerOnboarding } : {}),
        ...(primaryProviderActivator ? { primaryProviderActivator } : {}),
        ...(codexAuth ? { codexAuth } : {}),
      });
    }

    let usagePoll: ReturnType<typeof setInterval> | undefined;
    if (codexAuth) {
      const recordCodexWindows = (windows: readonly import('../agents/codex/codexAuthService.js').CodexRateLimitWindow[]) => {
        for (const window of windows) {
          usage.recordWindow({
            provider: 'codex',
            windowType: window.name,
            utilization: window.utilization,
            remaining: window.remaining,
            resetsAt: window.resetsAt,
            capturedAt: Date.now(),
            payload: window,
          });
        }
      };
      const refreshCodexUsage = async () => recordCodexWindows(await codexAuth!.readRateLimits());
      usageUnsubscribe = codexAuth.onRateLimitsUpdated(recordCodexWindows);
      await refreshCodexUsage().catch(error => {
        console.warn('[runtime] Failed to read Codex usage:', redactErrorMessage(error));
      });
      if (!options.disableUsagePolling) {
        usagePoll = setInterval(() => {
          void refreshCodexUsage().catch(error => {
            console.warn('[runtime] Failed to refresh Codex usage:', redactErrorMessage(error));
          });
        }, 60_000);
        usagePoll.unref?.();
      }
    }

    const recoveredTasks = await coordinator.recoverInterruptedTasks();
    const recoveredIds = new Set(recoveredTasks.map(task => task.id));
    for (const reservation of usage.reservations()) {
      const task = reservation.taskId ? tasks.findById(reservation.taskId) : undefined;
      if (!reservation.taskId || !task || recoveredIds.has(reservation.taskId) || ['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status)) {
        try { usage.release(reservation.id); } catch { /* already finalized */ }
      }
    }
    await notifyRecoveredTasks(client, recoveredTasks, events, tasks, rendererFactory);

    return { database, projects, settings, settingsService, tasks, events, messages, memories, worktrees, providers, coordinator, renderers: runtimeRenderers, usage, pendingTasks, ...(providerOnboarding ? { providerOnboarding } : {}), ...(usagePoll ? { usagePoll } : {}), ...(usageUnsubscribe ? { usageUnsubscribe } : {}), ...(primaryAgent ? { primaryAgent } : {}), ...(codexTransport ? { codexTransport } : {}), ...(codexAuth ? { codexAuth } : {}) };
  } catch (error) {
    clearTaskCoordinator();
    clearAgentRuntimeServices();
    clearPrimaryAgentService();
    clearUsageAdmissionService();
    usageUnsubscribe?.();
    await codexAuth?.close().catch(() => undefined);
    await (codexProvider as AgentProvider & { close?: () => Promise<void> } | undefined)?.close?.().catch(() => undefined);
    await codexTransport?.close().catch(() => undefined);
    closeProjectStore();
    throw error;
  }
}

export async function stopRuntime(runtime: RuntimeServices): Promise<void> {
  await runtime.coordinator.shutdown();
  await Promise.all([...runtime.renderers].map(renderer => Promise.resolve(renderer.dispose?.()).catch(error => {
    console.warn('[runtime] Failed to dispose task renderer:', redactErrorMessage(error));
  })));
  clearTaskCoordinator();
  clearAgentRuntimeServices();
  clearPrimaryAgentService();
  clearUsageAdmissionService();
  if (runtime.usagePoll) clearInterval(runtime.usagePoll);
  runtime.usageUnsubscribe?.();
  await runtime.codexAuth?.close().catch(() => undefined);
  const codex = (() => { try { return runtime.providers.require('codex') as AgentProvider & { close?: () => Promise<void> }; } catch { return undefined; } })();
  await codex?.close?.().catch(() => undefined);
  await runtime.codexTransport?.close().catch(() => undefined);
  closeProjectStore();
}

async function notifyRecoveredTasks(
  client: Client,
  recoveredTasks: readonly import('../types.js').TaskRecord[],
  events: EventRepository,
  tasks: import('../repositories/taskRepository.js').TaskRepository,
  rendererFactory: (thread: AnyThreadChannel) => TaskRenderer,
): Promise<void> {
  for (const task of recoveredTasks) {
    let channel: ({ send(payload: unknown): Promise<unknown> } & object) | null = null;
    let fetchError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        channel = await client.channels?.fetch(task.threadId) as typeof channel;
        fetchError = undefined;
        break;
      } catch (error) {
        fetchError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 25 * attempt));
      }
    }
    if (fetchError) {
      console.warn(`[runtime] Recovery checkpoint for task ${task.id} remains pending; Discord channel fetch failed:`, redactErrorMessage(fetchError));
    }
    if (!channel) continue;

    const renderer = rendererFactory(channel as AnyThreadChannel);
    try {
      await Promise.resolve(renderer.start(channel as AnyThreadChannel, {
        task,
        ...(tasks.getWorktree(task.id) ? { worktree: tasks.getWorktree(task.id) } : {}),
        phase: 'Recovery checkpoint',
      })).catch((error: unknown) => {
        console.warn('[runtime] Failed to reconstruct task control card:', redactErrorMessage(error));
      });

      const storedEvents = events.list(task.id);
      let detail: string | undefined;
      for (let index = storedEvents.length - 1; index >= 0; index--) {
        const event = storedEvents[index].event;
        if (event.type === 'status' && event.phase === 'Recovery checkpoint') {
          detail = event.detail;
          break;
        }
      }

      const content = [
        `⚠️ Task interrupted during bot restart: **${task.objective.slice(0, 160)}**`,
        detail ?? 'The task state was preserved. Resume requires explicit user action; no provider turn was replayed.',
        'Send a new message in this thread when you are ready to resume.',
      ].join('\n');

      await channel.send({ content }).catch((error: unknown) => {
        console.warn(`[runtime] Failed to post recovery checkpoint for task ${task.id}:`, redactErrorMessage(error));
      });
    } finally {
      await Promise.resolve(renderer.dispose?.()).catch(error => {
        console.warn(`[runtime] Failed to dispose recovery renderer for task ${task.id}:`, redactErrorMessage(error));
      });
    }
  }
}

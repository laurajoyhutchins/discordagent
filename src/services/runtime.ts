import type { Client } from 'discord.js';
import type { DatabaseHandle } from '../db/database.js';
import type { AgentProvider, AgentProviderId } from '../agents/contracts.js';
import { ClaudeProvider } from '../agents/claude/claudeProvider.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { createTaskCoordinator, type TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { DiscordInteractionBroker } from '../discord/interactionBroker.js';
import { DiscordTaskRenderer } from '../discord/taskRenderer.js';
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
import { clearAgentRuntimeServices, setAgentRuntimeServices } from './agentRuntimeService.js';
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
import { OpenCodeAcpTransport } from '../agents/opencode/acpTransport.js';
import { OpenCodeProvider } from '../agents/opencode/opencodeProvider.js';

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
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  coordinator: TaskCoordinator;
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
    const tasks = createTaskRepository(database);
    const events = createEventRepository(database);
    const messages = createMessageRepository(database);
    const memories = createMemoryRepository(database);
    const usage = createUsageAdmissionService(createUsageRepository(database), { primaryReserve: config.primaryUsageReserve });
    const worktrees = createWorktreeManager({
      baseDirectory: options.worktreesBaseDir ?? config.worktreesBaseDir,
      git: options.git ?? createGitClient(),
    });
    const providers = new ProviderRegistry();
    if (!options.disableClaude && config.claudeEnabled) {
      const claudeProvider = options.claudeProvider ?? new ClaudeProvider({
        timeoutMs: config.claudeTimeoutMs,
        mcpServers: config.mcpServers,
        defaultModel: config.defaultModel,
        resolveProjectModel: projectName => projects.findByName(projectName)?.models?.claude,
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
        codexProvider = new CodexProvider({ transport: codexTransport, auth: codexAuth, defaultModel: config.defaultCodexModel });
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
      throw new Error(`Runtime expected an OpenCode provider, received "${openCodeProvider?.id ?? 'none'}"`);
    }
    if (!options.disableOpenCode) {
      if (!openCodeProvider && config.openCodeEnabled) {
        openCodeProvider = new OpenCodeProvider({
          cliPath: config.openCodeCliPath,
          timeoutMs: config.openCodeTimeoutMs,
          defaultModel: config.defaultOpenCodeModel,
          resolveProjectModel: projectName => projects.findByName(projectName)?.models?.opencode,
          createConnection: handlers => Promise.resolve(new OpenCodeAcpTransport({
            cliPath: config.openCodeCliPath,
            handlers,
          })),
        });
      }
      if (openCodeProvider) {
        if (openCodeProvider.id !== 'opencode') {
          throw new Error(`Runtime expected an OpenCode provider, received "${openCodeProvider.id}"`);
        }
        try {
          const availability = await openCodeProvider.checkAvailability();
          if (availability.available) {
            providers.register(openCodeProvider);
          } else {
            console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(availability.reason ?? 'OpenCode provider is unavailable'));
          }
        } catch (error) {
          console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(error));
        }
      }
    }

    const coordinator = createTaskCoordinator({
      projects,
      tasks,
      events,
      worktrees,
      providers,
      usage,
      rendererFactory: () => new DiscordTaskRenderer({ notifyUserId: config.notifyUserId }),
      brokerFactory: () => new DiscordInteractionBroker(),
    });

    const pendingTasks = createPendingTaskService(coordinator);
    initUsageTracker(client);
    initRoborevWatcher(client);
    setTaskCoordinator(coordinator);
    let providerOnboarding: ProviderOnboardingService | undefined;
    setAgentRuntimeServices({ providers, tasks, pendingTasks, ...(codexAuth ? { codexAuth } : {}) });
    setUsageAdmissionService(usage);
    let primaryAgent: PrimaryAgentService | undefined;
    let primaryProviderActivator: ((provider: AgentProviderId) => Promise<void>) | undefined;
    let selectedProvider = settings.getDefaultProvider();
    if (!options.disablePrimaryAgent && config.authorizedUserId) {
      const guild = await client.guilds.fetch(config.guildId);
      const primaryChannel = await ensurePrimaryAgentChannel(guild, config.authorizedRoleIds);
      const context = createContextAssembler({ projects, tasks, messages, memories, usage });
      const createPrimaryModel = (provider: AgentProviderId): PrimaryModel | undefined => {
        if (options.primaryModel) return options.primaryModel;
        if (provider === 'claude' && providers.list().includes('claude')) {
          return new ClaudePrimaryModel({ model: config.primaryAgentModel });
        }
        if (provider === 'codex' && codexTransport && codexAuth) {
          return new CodexPrimaryModel({
            transport: codexTransport,
            auth: codexAuth,
            model: config.primaryAgentModel || config.defaultCodexModel,
          });
        }
        return undefined;
      };
      const activatePrimaryProvider = async (provider: AgentProviderId): Promise<void> => {
        const model = createPrimaryModel(provider);
        if (!model) throw new Error(`Provider ${provider} is not available for the PM chat on this host.`);
        primaryAgent = createPrimaryAgentService({
          channelId: primaryChannel.id, ownerId: config.authorizedUserId!,
          model,
          context, messages, memories, projects, coordinator,
          fetchProjectChannel: async id => { const channel = await client.channels.fetch(id).catch(() => null); return channel?.isTextBased() && !channel.isDMBased() && !channel.isThread() ? channel as import('discord.js').TextChannel : null; },
        });
        setPrimaryAgentService(primaryAgent);
      };
      primaryProviderActivator = activatePrimaryProvider;
      setAgentRuntimeServices({ providers, tasks, pendingTasks, primaryProviderActivator, ...(codexAuth ? { codexAuth } : {}) });
      providerOnboarding = createProviderOnboardingService({
        ownerId: config.authorizedUserId,
        settings,
        providers,
        pmProviderIds: providers.list().filter(provider => provider !== 'opencode'),
        channel: primaryChannel,
        onSelected: activatePrimaryProvider,
      });
      if (selectedProvider) {
        try {
          await activatePrimaryProvider(selectedProvider);
        } catch (error) {
          console.warn(`[runtime] Saved PM provider ${selectedProvider} is unavailable:`, redactErrorMessage(error));
          settings.set('default_provider', '');
          selectedProvider = undefined;
        }
      }
      if (!selectedProvider) {
        await providerOnboarding.ensurePrompt();
      }
    }
    if (providerOnboarding || primaryProviderActivator) {
      setAgentRuntimeServices({
        providers,
        tasks,
        pendingTasks,
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
    await notifyRecoveredTasks(client, recoveredTasks, events);

    return { database, projects, settings, tasks, events, messages, memories, worktrees, providers, coordinator, usage, pendingTasks, ...(providerOnboarding ? { providerOnboarding } : {}), ...(usagePoll ? { usagePoll } : {}), ...(usageUnsubscribe ? { usageUnsubscribe } : {}), ...(primaryAgent ? { primaryAgent } : {}), ...(codexTransport ? { codexTransport } : {}), ...(codexAuth ? { codexAuth } : {}) };
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
): Promise<void> {
  for (const task of recoveredTasks) {
    const channel = await client.channels?.fetch(task.threadId).catch(() => null);
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') continue;

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

    await channel.send({ content }).catch(error => {
      console.warn(`[runtime] Failed to post recovery checkpoint for task ${task.id}:`, redactErrorMessage(error));
    });
  }
}

import type { Client } from 'discord.js';
import type { DatabaseHandle } from '../db/database.js';
import type { AgentProvider } from '../agents/contracts.js';
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
  initializeProjectStore,
} from './projectStore.js';
import { initRoborevWatcher } from './roborevWatcher.js';
import {
  clearTaskCoordinator,
  setTaskCoordinator,
} from './taskCoordinatorService.js';
import { captureRateLimitEvent, captureSessionResult, initUsageTracker } from './usageTracker.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface RuntimeOptions {
  databasePath?: string;
  legacyPath?: string;
  worktreesBaseDir?: string;
  git?: GitClient;
  claudeProvider?: AgentProvider;
}

export interface RuntimeServices {
  database: DatabaseHandle;
  projects: ProjectRepository;
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  coordinator: TaskCoordinator;
}

export async function startRuntime(
  client: Client,
  options: RuntimeOptions = {},
): Promise<RuntimeServices> {
  clearTaskCoordinator();

  try {
    initializeProjectStore({
      databasePath: options.databasePath ?? config.databasePath,
      ...(options.legacyPath ? { legacyPath: options.legacyPath } : {}),
    });

    const database = getProjectDatabase();
    const projects = getProjectRepository();
    const tasks = createTaskRepository(database);
    const events = createEventRepository(database);
    const worktrees = createWorktreeManager({
      baseDirectory: options.worktreesBaseDir ?? config.worktreesBaseDir,
      git: options.git ?? createGitClient(),
    });
    const providers = new ProviderRegistry();
    const claudeProvider = options.claudeProvider ?? new ClaudeProvider({
      timeoutMs: config.claudeTimeoutMs,
      mcpServers: config.mcpServers,
      defaultModel: config.defaultModel,
      resolveProjectModel: projectName => projects.findByName(projectName)?.models?.claude,
      onRateLimit: captureRateLimitEvent,
      onSessionResult: captureSessionResult,
    });
    if (claudeProvider.id !== 'claude') {
      throw new Error(`Runtime expected a Claude provider, received "${claudeProvider.id}"`);
    }
    providers.register(claudeProvider);

    const coordinator = createTaskCoordinator({
      projects,
      tasks,
      events,
      worktrees,
      providers,
      rendererFactory: () => new DiscordTaskRenderer({ notifyUserId: config.notifyUserId }),
      brokerFactory: () => new DiscordInteractionBroker(),
    });

    initUsageTracker(client);
    initRoborevWatcher(client);
    setTaskCoordinator(coordinator);
    const recoveredTasks = await coordinator.recoverInterruptedTasks();
    await notifyRecoveredTasks(client, recoveredTasks, events);

    return { database, projects, tasks, events, worktrees, providers, coordinator };
  } catch (error) {
    clearTaskCoordinator();
    closeProjectStore();
    throw error;
  }
}

export async function stopRuntime(_runtime: RuntimeServices): Promise<void> {
  clearTaskCoordinator();
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

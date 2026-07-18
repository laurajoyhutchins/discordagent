import { randomUUID } from 'node:crypto';
import type { AnyThreadChannel, Message } from 'discord.js';
import type {
  AgentEvent,
  AgentProvider,
  AgentProviderId,
  AgentRunHost,
  AgentTaskSettings,
  AgentTurnSettings,
  ApprovalDecision,
  ContinueTaskInput,
  ProviderRun,
  ReasoningEffort,
  TaskOutcome,
  TaskResult,
  UserAnswer,
} from '../agents/contracts.js';
import { validateSupportedAgentSettings } from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { InteractionBroker } from '../discord/interactionBroker.js';
import type { TaskRenderer, TaskRenderContext } from '../discord/taskRenderer.js';
import type { WorktreeManager } from '../git/worktreeManager.js';
import type { EventRepository } from '../repositories/eventRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { Project, TaskRecord } from '../types.js';
import type { UsageAdmissionService } from '../services/usageAdmission.js';
import type { SettingsService } from '../services/settingsService.js';
import {
  redactAgentEvent,
  redactErrorMessage,
  redactApprovalRequest,
  redactTaskResult,
  redactUserQuestion,
  redactSensitiveText,
} from '../utils/redaction.js';
import { recoverInterruptedTasks as recoverTasks } from './taskRecovery.js';
import type { TaskCapabilityPreflight } from './capabilityPreflight.js';

export interface StartFromMessageInput {
  projectName: string;
  prompt: string;
  message: Message;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface StartInExistingThreadInput {
  projectName: string;
  prompt: string;
  thread: AnyThreadChannel;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ContinueFromMessageInput {
  prompt: string;
  message: Message;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ContinueInThreadInput {
  prompt: string;
  thread: AnyThreadChannel;
  provider?: AgentProviderId;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface TaskCoordinator {
  startFromMessage(input: StartFromMessageInput): Promise<TaskRecord>;
  startInExistingThread(input: StartInExistingThreadInput): Promise<TaskRecord>;
  continueFromMessage(input: ContinueFromMessageInput): Promise<void>;
  continueInThread(input: ContinueInThreadInput): Promise<void>;
  cancelByThread(threadId: string): Promise<boolean>;
  closeTask(taskId: string): Promise<void>;
  recoverInterruptedTasks(): Promise<TaskRecord[]>;
  shutdown(): Promise<void>;
  estimateHandoff(threadId: string, targetProvider: AgentProviderId): Promise<import('../agents/contracts.js').HandoffEstimate>;
  handoffFromThread(input: { sourceThread: AnyThreadChannel; targetProvider: AgentProviderId }): Promise<TaskRecord>;
}

export interface TaskCoordinatorDependencies {
  projects: ProjectRepository;
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  settings: SettingsService;
  rendererFactory(thread: AnyThreadChannel): TaskRenderer;
  brokerFactory(thread: AnyThreadChannel): InteractionBroker;
  idFactory?: (prefix: string) => string;
  usage?: UsageAdmissionService;
  capabilityPreflight?: TaskCapabilityPreflight;
}

interface RunningGate {
  promise: Promise<void>;
  resolve(): void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
function validateProviderTurnSettings(provider: AgentProviderId, settings: AgentTurnSettings): void {
  validateSupportedAgentSettings(provider, settings, 'turn');
}

function effectiveTurnSettings(
  settings: AgentTurnSettings,
  model?: string,
  reasoningEffort?: ReasoningEffort,
): AgentTurnSettings {
  return {
    ...settings,
    ...(model !== undefined ? { model } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

export function createTaskCoordinator(
  dependencies: TaskCoordinatorDependencies,
): TaskCoordinator {
  const idFactory = dependencies.idFactory ?? (prefix => `${prefix}-${randomUUID()}`);
  const activeReservations = new Map<string, string>();
  const interruptionRequested = new Set<string>();
  const activeRenderers = new Map<string, TaskRenderer>();
  const startingTasks = new Map<string, { provider: AgentProvider; cancelled: boolean }>();

  async function syncRendererCard(
    renderer: TaskRenderer,
    taskId: string,
    overrides: Pick<TaskRenderContext, 'phase' | 'usagePosture' | 'result'> = {},
  ): Promise<void> {
    if (!renderer.updateCard) return;
    const task = dependencies.tasks.findById(taskId);
    if (!task) return;
    const worktree = dependencies.tasks.getWorktree(taskId);
    let usagePosture: string | undefined = overrides.usagePosture;
    if (!usagePosture && dependencies.usage) usagePosture = dependencies.usage.posture(task.provider).posture;
    try {
      await renderer.updateCard({
        task,
        ...(worktree ? { worktree } : {}),
        ...(usagePosture ? { usagePosture } : {}),
        ...(overrides.phase ? { phase: overrides.phase } : {}),
        ...(overrides.result ? { result: overrides.result } : {}),
      });
    } catch (error) {
      console.warn('[taskCoordinator] Failed to update task control card:', redactErrorMessage(error));
    }
  }

  async function startRendererSafely(
    renderer: TaskRenderer,
    thread: AnyThreadChannel,
    context: TaskRenderContext,
  ): Promise<void> {
    try {
      await renderer.start(thread, context);
    } catch (error) {
      console.warn('[taskCoordinator] Failed to initialize task renderer:', redactErrorMessage(error));
    }
  }

  function resolveProjectProvider(projectName: string, override?: AgentProviderId): { project: Project; providerId: AgentProviderId } {
    const project = dependencies.projects.findByName(projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    return { project, providerId: override ?? project.defaultProvider };
  }

  async function requireAvailableProvider(
    resolved: { project: Project; providerId: AgentProviderId },
  ): Promise<{ project: Project; provider: AgentProvider; providerId: AgentProviderId }> {
    const provider = dependencies.providers.require(resolved.providerId);
    const availability = await provider.checkAvailability();
    if (!availability.available) throw new Error(availability.reason ?? `Provider "${resolved.providerId}" is unavailable`);
    return { ...resolved, provider };
  }

  async function startNewTask(input: {
    project: Project;
    provider: AgentProvider;
    providerId: AgentProviderId;
    prompt: string;
    thread: AnyThreadChannel;
    settings: AgentTaskSettings;
    baseBranch?: string;
    reservationId?: string;
  }): Promise<TaskRecord> {
    const taskId = idFactory('task');

    const createdWorktree = await dependencies.worktrees.create({
      repositoryPath: input.project.workingDirectory,
      provider: input.providerId,
      taskId,
      threadId: input.thread.id,
      objective: input.prompt,
      ...((input.baseBranch ?? input.project.baseBranch) ? { baseBranch: input.baseBranch ?? input.project.baseBranch } : {}),
    });

    try {
      dependencies.tasks.createWithWorktree({
        taskId,
        projectName: input.project.name,
        provider: input.providerId,
        channelId: input.thread.parentId ?? input.project.agentChannelId,
        threadId: input.thread.id,
        objective: input.prompt,
        settings: input.settings,
        worktree: {
          id: idFactory('worktree'),
          repositoryPath: createdWorktree.repositoryPath,
          worktreePath: createdWorktree.worktreePath,
          branchName: createdWorktree.branchName,
          baseRef: createdWorktree.baseRef,
        },
      });
    } catch (error) {
      await dependencies.worktrees.remove({
        repositoryPath: createdWorktree.repositoryPath,
        worktreePath: createdWorktree.worktreePath,
        branchName: createdWorktree.branchName,
        removeBranch: true,
      }).catch(cleanupError => {
        console.error('[taskCoordinator] Failed to clean unpersisted worktree:', redactErrorMessage(cleanupError));
      });
      throw error;
    }

    if (input.reservationId && dependencies.usage) {
      try {
        dependencies.usage.attach(input.reservationId, taskId);
        activeReservations.set(taskId, input.reservationId);
      } catch (error) {
        dependencies.usage.release(input.reservationId);
        const failed = dependencies.tasks.transition(taskId, ['created'], 'failed');
        dependencies.tasks.saveResult(taskId, {
          provider: failed.provider,
          outcome: 'failed',
          exitType: 'usage_reservation_attach_failed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          summary: 'The task was preserved but could not attach its usage reservation.',
          error: { code: 'usage_reservation_attach_failed', message: redactErrorMessage(error), retryable: true },
        });
        throw error;
      }
    }

    const renderer = dependencies.rendererFactory(input.thread);
    const broker = dependencies.brokerFactory(input.thread);
    activeRenderers.set(taskId, renderer);
    await startRendererSafely(renderer, input.thread, {
      task: dependencies.tasks.findById(taskId)!,
      worktree: dependencies.tasks.getWorktree(taskId),
    });
    dependencies.tasks.transition(taskId, ['created'], 'starting');
    await syncRendererCard(renderer, taskId, { phase: 'Starting' });
    return executeTurn({
      taskId,
      project: input.project,
      provider: input.provider,
      prompt: input.prompt,
      thread: input.thread,
      workingDirectory: createdWorktree.worktreePath,
      renderer,
      broker,
      settings: input.settings,
      reservationId: input.reservationId,
    });
  }

  async function executeTurn(input: {
    taskId: string;
    project: Project;
    provider: AgentProvider;
    prompt: string;
    thread: AnyThreadChannel;
    workingDirectory: string;
    renderer: TaskRenderer;
    broker: InteractionBroker;
    settings: AgentTaskSettings;
    turnSettings?: AgentTurnSettings;
    session?: ContinueTaskInput['session'];
    reservationId?: string;
  }): Promise<TaskRecord> {
    const gate = runningGate();
    const startup = input.session ? undefined : { provider: input.provider, cancelled: false };
    if (startup) startingTasks.set(input.taskId, startup);
    const host = createHost(input.taskId, input.provider, input.thread, input.renderer, input.broker, gate);
    const providerInput = {
      taskId: input.taskId,
      projectName: input.project.name,
      workingDirectory: input.workingDirectory,
      channelId: input.thread.parentId ?? input.project.agentChannelId,
      threadId: input.thread.id,
      prompt: input.prompt,
      settings: input.settings,
      ...(input.settings.model !== undefined ? { model: input.settings.model } : {}),
      ...(input.settings.reasoningEffort !== undefined ? { reasoningEffort: input.settings.reasoningEffort } : {}),
      ...(input.turnSettings ? { turnSettings: input.turnSettings } : {}),
    };

    let run: ProviderRun;
    try {
      run = input.session
        ? await input.provider.continueTask({ ...providerInput, session: input.session }, host)
        : await input.provider.startTask(providerInput, host);
    } catch (error) {
      startingTasks.delete(input.taskId);
      gate.resolve();
      return failStartingTask(input.taskId, input.provider.id, input.renderer, error, input.reservationId);
    }
    // Cancellation may terminalize a starting task before the provider returns its
    // session. Keep a late completion from becoming an unhandled rejection while
    // the guards below discard it without changing the terminal task.
    void run.completion.catch(() => undefined);

    startingTasks.delete(input.taskId);
    if (startup?.cancelled) {
      void input.provider.cancelTask(run.session.sessionId).catch(error => {
        console.warn('[taskCoordinator] Late startup cancellation failed:', redactErrorMessage(error));
      });
      gate.resolve();
      return dependencies.tasks.findById(input.taskId)!;
    }

    if (!input.session) {
      const current = dependencies.tasks.findById(input.taskId);
      if (!current || TERMINAL_STATUSES.has(current.status)) {
        gate.resolve();
        return current ?? dependencies.tasks.findById(input.taskId)!;
      }
      dependencies.tasks.attachProviderSession(input.taskId, run.session);
    } else if (run.session.provider !== input.session.provider
      || run.session.sessionId !== input.session.sessionId) {
      gate.resolve();
      return failStartingTask(
        input.taskId,
        input.provider.id,
        input.renderer,
        new Error('Provider continuation returned a different session identity'),
        input.reservationId,
      );
    }

    const beforeRunning = dependencies.tasks.findById(input.taskId);
    if (!beforeRunning || TERMINAL_STATUSES.has(beforeRunning.status)) {
      gate.resolve();
      return beforeRunning ?? dependencies.tasks.findById(input.taskId)!;
    }

    dependencies.tasks.transition(input.taskId, ['starting'], 'running');
    await syncRendererCard(input.renderer, input.taskId, { phase: 'Provider turn running' });
    gate.resolve();

    let result: TaskResult;
    try {
      result = await run.completion;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        provider: input.provider.id,
        outcome: 'failed',
        exitType: 'error',
        startedAt: Date.now(),
        completedAt: Date.now(),
        sessionId: run.session.sessionId,
        summary: message,
        error: { code: 'provider_completion_failed', message, retryable: true },
      };
    }
    return finalizeTask(input.taskId, result, input.renderer, input.reservationId);
  }

  function createHost(
    taskId: string,
    provider: AgentProvider,
    thread: AnyThreadChannel,
    renderer: TaskRenderer,
    broker: InteractionBroker,
    gate: RunningGate,
  ): AgentRunHost {
    async function waitForDecision<T>(operation: () => Promise<T>): Promise<T> {
      await gate.promise;
      const before = dependencies.tasks.findById(taskId);
      if (!before || before.status !== 'running') {
        throw new Error(`Task "${taskId}" is not running and cannot request user input`);
      }
      dependencies.tasks.transition(taskId, ['running'], 'waiting_for_user');
      await syncRendererCard(renderer, taskId, { phase: 'Waiting for user input' });
      try {
        return await operation();
      } finally {
        const after = dependencies.tasks.findById(taskId);
        if (after?.status === 'waiting_for_user') {
          dependencies.tasks.transition(taskId, ['waiting_for_user'], 'running');
          await syncRendererCard(renderer, taskId, { phase: 'Provider turn resumed' });
        }
      }
    }

    return {
      async emit(event: AgentEvent): Promise<void> {
        const currentTask = dependencies.tasks.findById(taskId);
        if (activeRenderers.get(taskId) !== renderer || !currentTask || TERMINAL_STATUSES.has(currentTask.status)) return;
        const safeEvent = redactAgentEvent(event);
        dependencies.events.append(taskId, safeEvent);
        await renderer.handle(safeEvent).catch(error => {
          console.warn('[taskCoordinator] Failed to render task event:', redactErrorMessage(error));
        });
        if (safeEvent.type === 'status') {
          await syncRendererCard(renderer, taskId, { phase: safeEvent.phase });
        }

        if (safeEvent.type === 'usage' && dependencies.usage) {
          dependencies.usage.recordUsage(provider.id, safeEvent.usage);
          const state = dependencies.usage.posture(provider.id);
          if ((state.posture === 'preserve' || state.posture === 'exhausted')
            && !interruptionRequested.has(taskId)) {
            interruptionRequested.add(taskId);
            const checkpoint = redactAgentEvent({
              type: 'status',
              phase: 'Capacity checkpoint',
              detail: 'Provider capacity is critically constrained. The current turn is being interrupted once; the task session, branch, and worktree are preserved.',
            });
            dependencies.events.append(taskId, checkpoint, `usage-capacity-checkpoint:${activeReservations.get(taskId) ?? Date.now()}`);
            await renderer.handle(checkpoint).catch(() => undefined);
            void gate.promise.then(async () => {
              const current = dependencies.tasks.findById(taskId);
              if (!current || TERMINAL_STATUSES.has(current.status)) return;
              await provider.cancelTask(current.providerSessionId ?? taskId);
            }).catch(error => {
              console.warn('[taskCoordinator] Failed to interrupt constrained provider turn:', redactErrorMessage(error));
            });
          }
        }
      },
      requestApproval(request): Promise<ApprovalDecision> {
        const safeRequest = redactApprovalRequest(request);
        return waitForDecision(() => broker.requestApproval(thread, safeRequest));
      },
      requestUserInput(question): Promise<UserAnswer> {
        const safeQuestion = redactUserQuestion(question);
        return waitForDecision(() => broker.requestUserInput(thread, safeQuestion));
      },
    };
  }

  async function failStartingTask(
    taskId: string,
    provider: AgentProviderId,
    renderer: TaskRenderer,
    error: unknown,
    reservationId?: string,
  ): Promise<TaskRecord> {
    const message = error instanceof Error ? error.message : String(error);
    const result: TaskResult = {
      provider,
      outcome: 'failed',
      exitType: 'error',
      startedAt: Date.now(),
      completedAt: Date.now(),
      summary: message,
      error: { code: 'provider_start_failed', message, retryable: false },
    };
    let current = dependencies.tasks.findById(taskId);
    if (!current) throw new Error(`Task "${taskId}" disappeared during provider startup`);
    if (!TERMINAL_STATUSES.has(current.status)) {
      current = dependencies.tasks.transition(taskId, [current.status], 'failed');
    }
    const stored = current.status === 'failed'
      ? result
      : {
        ...result,
        outcome: current.status as TaskOutcome,
        exitType: current.status,
        summary: current.status === 'cancelled' ? 'The task was cancelled.' : result.summary,
      };
    const safeStored = redactTaskResult(stored);
    dependencies.tasks.saveResult(taskId, safeStored);
    if (reservationId && dependencies.usage) dependencies.usage.complete(reservationId, safeStored);
    activeReservations.delete(taskId);
    interruptionRequested.delete(taskId);
    await syncRendererCard(renderer, taskId, { result: safeStored, phase: 'Failed to start' });
    await finishRendererSafely(renderer, safeStored);
    activeRenderers.delete(taskId);
    return dependencies.tasks.findById(taskId)!;
  }

  async function finalizeTask(
    taskId: string,
    result: TaskResult,
    renderer: TaskRenderer,
    reservationId?: string,
  ): Promise<TaskRecord> {
    const alreadyFinalized = dependencies.tasks.getResult(taskId);
    if (alreadyFinalized) {
      activeRenderers.delete(taskId);
      activeReservations.delete(taskId);
      return dependencies.tasks.findById(taskId)!;
    }
    const worktree = dependencies.tasks.getWorktree(taskId);
    const enriched: TaskResult = {
      ...result,
      ...(result.branchName || !worktree ? {} : { branchName: worktree.branchName }),
    };
    let current = dependencies.tasks.findById(taskId);
    if (!current) throw new Error(`Task "${taskId}" disappeared during execution`);

    if (!TERMINAL_STATUSES.has(current.status)) {
      current = dependencies.tasks.transition(taskId, [current.status], enriched.outcome);
    }

    const storedResult = current.status === enriched.outcome
      ? enriched
      : {
        ...enriched,
        outcome: current.status as TaskOutcome,
        exitType: current.status,
        summary: current.status === 'cancelled'
          ? 'The task was cancelled.'
          : enriched.summary,
      };
    const existingResult = dependencies.tasks.getResult(taskId);
    const safeResult = existingResult ?? redactTaskResult(storedResult);
    if (!existingResult) dependencies.tasks.saveResult(taskId, safeResult);
    if (reservationId && dependencies.usage) dependencies.usage.complete(reservationId, safeResult);
    activeReservations.delete(taskId);
    interruptionRequested.delete(taskId);
    await syncRendererCard(renderer, taskId, { result: safeResult, phase: 'Completed' });
    await finishRendererSafely(renderer, safeResult);
    activeRenderers.delete(taskId);
    return dependencies.tasks.findById(taskId)!;
  }

  async function continueInThreadInternal(input: ContinueInThreadInput): Promise<void> {
    const task = dependencies.tasks.findByThreadId(input.thread.id);
    if (!task) throw new Error('No task is associated with this Discord thread');
    if (input.provider && input.provider !== task.provider) {
      throw new Error(`Task provider is immutable (${task.provider}); provider handoff requires a sibling thread`);
    }
    if (!TERMINAL_STATUSES.has(task.status)) {
      throw new Error(`Task is ${task.status}; wait for it to finish or cancel it first`);
    }
    const project = dependencies.projects.findByName(task.projectName);
    if (!project) throw new Error(`Project "${task.projectName}" not found`);
    if (task.settingsMalformed) {
      throw new Error(`Task "${task.id}" has a malformed settings snapshot; refusing continuation`);
    }
    const settings: AgentTaskSettings = task.settings && !task.settingsMalformed
      ? task.settings
      : dependencies.settings.resolveTaskSettings({
      projectName: project.name,
      provider: task.provider,
    });
    validateSupportedAgentSettings(task.provider, settings, 'task');
    const turnSettings = effectiveTurnSettings({}, input.model, input.reasoningEffort);
    validateProviderTurnSettings(task.provider, turnSettings);
    dependencies.capabilityPreflight?.assertCanUseTaskThread?.(input.thread as never);
    if (!task.providerSessionId) throw new Error('Task has no provider session to continue');
    const worktree = dependencies.tasks.getWorktree(task.id);
    if (!worktree || worktree.removedAt) throw new Error('Task worktree is no longer available');
    const provider = dependencies.providers.require(task.provider);
    const availability = await provider.checkAvailability();
    if (!availability.available) throw new Error(availability.reason ?? 'Provider unavailable');
    const reservation = await dependencies.usage?.reserve({ provider: task.provider, prompt: input.prompt });

    try {
      dependencies.tasks.reopenForContinuation(task.id);
      if (reservation && dependencies.usage) {
        dependencies.usage.attach(reservation.id, task.id);
        activeReservations.set(task.id, reservation.id);
      }
      const renderer = dependencies.rendererFactory(input.thread);
      const broker = dependencies.brokerFactory(input.thread);
      activeRenderers.set(task.id, renderer);
      const reopened = dependencies.tasks.findById(task.id)!;
      await startRendererSafely(renderer, input.thread, {
        task: reopened,
        worktree,
        phase: 'Resumed',
      });
      await executeTurn({
        taskId: task.id,
        project,
        provider,
        prompt: input.prompt,
        thread: input.thread,
        workingDirectory: worktree.worktreePath,
        renderer,
        broker,
        settings,
        ...(Object.keys(turnSettings).length > 0 ? { turnSettings } : {}),
        reservationId: reservation?.id,
        session: {
          provider: task.provider,
          sessionId: task.providerSessionId,
          createdAt: task.createdAt,
        },
      });
    } catch (error) {
      if (reservation && dependencies.usage) {
        try { dependencies.usage.release(reservation.id); } catch { /* already finalized */ }
        activeReservations.delete(task.id);
      }
      throw error;
    }
  }

  return {
    async startFromMessage(input: StartFromMessageInput): Promise<TaskRecord> {
      const resolved = resolveProjectProvider(input.projectName, input.provider);
      const validated = await requireAvailableProvider(resolved);
      const settings = dependencies.settings.resolveTaskSettings({
        projectName: input.projectName,
        provider: resolved.providerId,
        modelOverride: input.model,
        reasoningOverride: input.reasoningEffort,
      });
      validateSupportedAgentSettings(resolved.providerId, settings, 'task');
      await dependencies.worktrees.validateBaseBranch?.(validated.project.workingDirectory, validated.project.baseBranch);
      dependencies.capabilityPreflight?.assertCanCreateTaskThread(input.message.channel as never);
      const reservation = await dependencies.usage?.reserve({ provider: validated.providerId, prompt: input.prompt });
      try {
        const thread = await input.message.startThread({
          name: safeThreadName(validated.providerId, input.prompt),
          autoArchiveDuration: 60,
        });
        return await startNewTask({ ...validated, prompt: input.prompt, thread, settings, reservationId: reservation?.id });
      } catch (error) {
        if (reservation && dependencies.usage) {
          try { dependencies.usage.release(reservation.id); } catch { /* already consumed or released */ }
        }
        throw error;
      }
    },

    async startInExistingThread(input: StartInExistingThreadInput): Promise<TaskRecord> {
      const resolved = resolveProjectProvider(input.projectName, input.provider);
      const validated = await requireAvailableProvider(resolved);
      const settings = dependencies.settings.resolveTaskSettings({
        projectName: input.projectName,
        provider: resolved.providerId,
        modelOverride: input.model,
        reasoningOverride: input.reasoningEffort,
      });
      validateSupportedAgentSettings(resolved.providerId, settings, 'task');
      await dependencies.worktrees.validateBaseBranch?.(validated.project.workingDirectory, validated.project.baseBranch);
      dependencies.capabilityPreflight?.assertCanUseTaskThread?.(input.thread as never);
      const reservation = await dependencies.usage?.reserve({ provider: validated.providerId, prompt: input.prompt });
      try {
        return await startNewTask({ ...validated, prompt: input.prompt, thread: input.thread, settings, reservationId: reservation?.id });
      } catch (error) {
        if (reservation && dependencies.usage) {
          try { dependencies.usage.release(reservation.id); } catch { /* already consumed or released */ }
        }
        throw error;
      }
    },

    async continueFromMessage(input: ContinueFromMessageInput): Promise<void> {
      await continueInThreadInternal({
        prompt: input.prompt,
        thread: input.message.channel as AnyThreadChannel,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      });
    },

    continueInThread(input: ContinueInThreadInput): Promise<void> {
      return continueInThreadInternal(input);
    },

    async cancelByThread(threadId: string): Promise<boolean> {
      const task = dependencies.tasks.findByThreadId(threadId);
      if (!task || TERMINAL_STATUSES.has(task.status)) return false;
      const provider = dependencies.providers.require(task.provider);
      const startup = startingTasks.get(task.id);
      if (startup) startup.cancelled = true;
      if (task.providerSessionId) {
        void provider.cancelTask(task.providerSessionId).catch(error => {
        console.warn('[taskCoordinator] Provider cancellation failed:', redactErrorMessage(error));
        });
      }
      const current = dependencies.tasks.findById(task.id);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        dependencies.tasks.transition(task.id, [current.status], 'cancelled');
        const result: TaskResult = {
          provider: task.provider,
          outcome: 'cancelled',
          exitType: 'cancelled',
          startedAt: task.createdAt,
          completedAt: Date.now(),
          summary: 'The task was cancelled.',
        };
        dependencies.tasks.saveResult(task.id, result);
        const renderer = activeRenderers.get(task.id);
        if (renderer) {
          await syncRendererCard(renderer, task.id, { phase: 'Cancelled', result });
          await finishRendererSafely(renderer, result);
          activeRenderers.delete(task.id);
        }
      }
      const reservationId = activeReservations.get(task.id);
      if (reservationId && dependencies.usage) {
        try { dependencies.usage.release(reservationId); } catch { /* already completed */ }
        activeReservations.delete(task.id);
      }
      return true;
    },

    async closeTask(taskId: string): Promise<void> {
      const task = dependencies.tasks.findById(taskId);
      if (!task) throw new Error(`Task "${taskId}" not found`);
      if (!TERMINAL_STATUSES.has(task.status)) {
        throw new Error(`Task "${taskId}" must be terminal before closing`);
      }
      const worktree = dependencies.tasks.getWorktree(taskId);
      if (!worktree || worktree.removedAt) return;
      await dependencies.worktrees.remove({
        repositoryPath: worktree.repositoryPath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        removeBranch: false,
      });
      dependencies.tasks.markWorktreeRemoved(taskId);
    },

    async estimateHandoff(threadId: string, targetProvider: AgentProviderId) {
      const task = dependencies.tasks.findByThreadId(threadId);
      if (!task) throw new Error('No task is associated with this Discord thread');
      if (!TERMINAL_STATUSES.has(task.status)) throw new Error('Provider handoff requires a completed or interrupted source task');
      if (task.provider === targetProvider) throw new Error('The target provider is already active in this task');
      const events = dependencies.events.list(task.id);
      const transcriptCharacters = events.reduce((total, stored) => total + JSON.stringify(stored.event).length, 0);
      const changedFiles = new Set(events.flatMap(stored => stored.event.type === 'file_change' ? stored.event.paths : [])).size;
      const summaryCharacters = dependencies.tasks.getResult(task.id)?.summary?.length ?? task.objective.length;
      return dependencies.providers.require(targetProvider).estimateHandoff({
        sourceProvider: task.provider, targetProvider, transcriptCharacters, summaryCharacters, changedFiles,
      });
    },

    async handoffFromThread({ sourceThread, targetProvider }) {
      const source = dependencies.tasks.findByThreadId(sourceThread.id);
      if (!source) throw new Error('No task is associated with this Discord thread');
      if (!TERMINAL_STATUSES.has(source.status)) throw new Error('Provider handoff requires a terminal source task');
      if (source.provider === targetProvider) throw new Error('The target provider is already active in this task');
      const sourceWorktree = dependencies.tasks.getWorktree(source.id);
      if (!sourceWorktree || sourceWorktree.removedAt) throw new Error('The source worktree is unavailable');
      const inspection = await dependencies.worktrees.inspect(sourceWorktree.worktreePath);
      if (!inspection.exists || inspection.dirty) throw new Error('Commit or discard source worktree changes before provider handoff');
      const project = dependencies.projects.findByName(source.projectName);
      if (!project) throw new Error(`Project "${source.projectName}" not found`);
      const provider = dependencies.providers.require(targetProvider);
      const availability = await provider.checkAvailability();
      if (!availability.available) throw new Error(availability.reason ?? `${targetProvider} is unavailable`);
      const settings = dependencies.settings.resolveTaskSettings({
        projectName: project.name,
        provider: targetProvider,
      });
      validateSupportedAgentSettings(targetProvider, settings, 'task');
      await dependencies.worktrees.validateBaseBranch?.(project.workingDirectory, sourceWorktree.branchName);
      const parent = sourceThread.parent;
      if (!parent || !('threads' in parent) || !parent.threads || typeof parent.threads.create !== 'function') {
        throw new Error('The source thread parent cannot create a sibling thread');
      }
      dependencies.capabilityPreflight?.assertCanCreateTaskThread(parent as never);
      const result = dependencies.tasks.getResult(source.id);
      const prompt = [
        `Provider handoff from ${source.provider} task ${source.id}.`,
        `Original objective: ${source.objective}`,
        `Source branch: ${sourceWorktree.branchName}`,
        result?.summary ? `Completed work: ${result.summary}` : undefined,
        result?.verification?.length ? `Verification: ${result.verification.join('; ')}` : undefined,
        result?.unresolved?.length ? `Unresolved: ${result.unresolved.join('; ')}` : undefined,
        'Inspect the current repository state, continue the objective, and report verification and unresolved decisions.',
      ].filter(Boolean).join('\n');
      const reservation = await dependencies.usage?.reserve({ provider: targetProvider, prompt });
      let sibling: AnyThreadChannel;
      try {
        sibling = await (parent.threads.create as (options: { name: string; autoArchiveDuration: 60 }) => Promise<AnyThreadChannel>)({ name: safeThreadName(targetProvider, source.objective), autoArchiveDuration: 60 });
        const created = await startNewTask({ project, provider, providerId: targetProvider, prompt, thread: sibling, baseBranch: sourceWorktree.branchName, settings, reservationId: reservation?.id });
        await sourceThread.send({ content: `Provider handoff created: <#${sibling.id}> (${targetProvider}).` }).catch(() => undefined);
        await sibling.send({ content: `Continues source task <#${sourceThread.id}> using ${targetProvider}.` }).catch(() => undefined);
        return created;
      } catch (error) {
        if (reservation && dependencies.usage) {
          try { dependencies.usage.release(reservation.id); } catch { /* already completed */ }
        }
        throw error;
      }
    },

    recoverInterruptedTasks(): Promise<TaskRecord[]> {
      return recoverTasks(dependencies);
    },

    async shutdown(): Promise<void> {
      const renderers = [...activeRenderers.values()];
      activeRenderers.clear();
      await Promise.all(renderers.map(renderer => Promise.resolve(renderer.dispose?.()).catch(error => {
        console.warn('[taskCoordinator] Failed to dispose task renderer:', redactErrorMessage(error));
      })));
    },
  };
}

async function finishRendererSafely(renderer: TaskRenderer, result: TaskResult): Promise<void> {
  await renderer.finish(result).catch(error => {
    console.warn('[taskCoordinator] Failed to render terminal task result:', redactErrorMessage(error));
  });
  await Promise.resolve(renderer.dispose?.()).catch(error => {
    console.warn('[taskCoordinator] Failed to dispose terminal task renderer:', redactErrorMessage(error));
  });
}

function safeThreadName(provider: AgentProviderId, objective: string): string {
  const safeObjective = redactSensitiveText(objective).replace(/[\r\n]+/g, ' ').trim();
  return `${provider}: ${safeObjective || 'task'}`.slice(0, 100);
}

function runningGate(): RunningGate {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

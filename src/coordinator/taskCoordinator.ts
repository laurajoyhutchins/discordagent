import { randomUUID } from 'node:crypto';
import type { AnyThreadChannel, Message } from 'discord.js';
import type {
  AgentEvent,
  AgentProvider,
  AgentProviderId,
  AgentRunHost,
  ApprovalDecision,
  ContinueTaskInput,
  ProviderRun,
  TaskOutcome,
  TaskResult,
  UserAnswer,
} from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { InteractionBroker } from '../discord/interactionBroker.js';
import type { TaskRenderer } from '../discord/taskRenderer.js';
import type { WorktreeManager } from '../git/worktreeManager.js';
import type { EventRepository } from '../repositories/eventRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { Project, TaskRecord } from '../types.js';
import type { UsageAdmissionService } from '../services/usageAdmission.js';
import {
  redactAgentEvent,
  redactErrorMessage,
  redactApprovalRequest,
  redactTaskResult,
  redactUserQuestion,
} from '../utils/redaction.js';
import { recoverInterruptedTasks as recoverTasks } from './taskRecovery.js';

export interface StartFromMessageInput {
  projectName: string;
  prompt: string;
  message: Message;
  provider?: AgentProviderId;
  model?: string;
}

export interface StartInExistingThreadInput {
  projectName: string;
  prompt: string;
  thread: AnyThreadChannel;
  provider?: AgentProviderId;
  model?: string;
}

export interface ContinueFromMessageInput {
  prompt: string;
  message: Message;
  provider?: AgentProviderId;
  model?: string;
}

export interface ContinueInThreadInput {
  prompt: string;
  thread: AnyThreadChannel;
  provider?: AgentProviderId;
  model?: string;
}

export interface TaskCoordinator {
  startFromMessage(input: StartFromMessageInput): Promise<TaskRecord>;
  startInExistingThread(input: StartInExistingThreadInput): Promise<TaskRecord>;
  continueFromMessage(input: ContinueFromMessageInput): Promise<void>;
  continueInThread(input: ContinueInThreadInput): Promise<void>;
  cancelByThread(threadId: string): Promise<boolean>;
  closeTask(taskId: string): Promise<void>;
  recoverInterruptedTasks(): Promise<TaskRecord[]>;
  estimateHandoff(threadId: string, targetProvider: AgentProviderId): Promise<import('../agents/contracts.js').HandoffEstimate>;
  handoffFromThread(input: { sourceThread: AnyThreadChannel; targetProvider: AgentProviderId }): Promise<TaskRecord>;
}

export interface TaskCoordinatorDependencies {
  projects: ProjectRepository;
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
  providers: ProviderRegistry;
  rendererFactory(thread: AnyThreadChannel): TaskRenderer;
  brokerFactory(thread: AnyThreadChannel): InteractionBroker;
  idFactory?: (prefix: string) => string;
  usage?: UsageAdmissionService;
}

interface RunningGate {
  promise: Promise<void>;
  resolve(): void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function createTaskCoordinator(
  dependencies: TaskCoordinatorDependencies,
): TaskCoordinator {
  const idFactory = dependencies.idFactory ?? (prefix => `${prefix}-${randomUUID()}`);
  const activeReservations = new Map<string, string>();
  const interruptionRequested = new Set<string>();

  async function validateProjectProvider(
    projectName: string,
    override?: AgentProviderId,
  ): Promise<{ project: Project; provider: AgentProvider; providerId: AgentProviderId }> {
    const project = dependencies.projects.findByName(projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    const providerId = override ?? project.defaultProvider;
    const provider = dependencies.providers.require(providerId);
    const availability = await provider.checkAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? `Provider "${providerId}" is unavailable`);
    }
    return { project, provider, providerId };
  }

  async function startNewTask(input: {
    project: Project;
    provider: AgentProvider;
    providerId: AgentProviderId;
    prompt: string;
    thread: AnyThreadChannel;
    model?: string;
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

    dependencies.tasks.transition(taskId, ['created'], 'starting');
    const renderer = dependencies.rendererFactory(input.thread);
    const broker = dependencies.brokerFactory(input.thread);
    renderer.start(input.thread);
    return executeTurn({
      taskId,
      project: input.project,
      provider: input.provider,
      prompt: input.prompt,
      thread: input.thread,
      workingDirectory: createdWorktree.worktreePath,
      renderer,
      broker,
      model: input.model ?? input.project.models?.[input.providerId],
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
    model?: string;
    session?: ContinueTaskInput['session'];
    reservationId?: string;
  }): Promise<TaskRecord> {
    const gate = runningGate();
    const host = createHost(input.taskId, input.provider, input.thread, input.renderer, input.broker, gate);
    const providerInput = {
      taskId: input.taskId,
      projectName: input.project.name,
      workingDirectory: input.workingDirectory,
      channelId: input.thread.parentId ?? input.project.agentChannelId,
      threadId: input.thread.id,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
    };

    let run: ProviderRun;
    try {
      run = input.session
        ? await input.provider.continueTask({ ...providerInput, session: input.session }, host)
        : await input.provider.startTask(providerInput, host);
    } catch (error) {
      gate.resolve();
      return failStartingTask(input.taskId, input.provider.id, input.renderer, error, input.reservationId);
    }

    if (!input.session) {
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

    dependencies.tasks.transition(input.taskId, ['starting'], 'running');
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
      try {
        return await operation();
      } finally {
        const after = dependencies.tasks.findById(taskId);
        if (after?.status === 'waiting_for_user') {
          dependencies.tasks.transition(taskId, ['waiting_for_user'], 'running');
        }
      }
    }

    return {
      async emit(event: AgentEvent): Promise<void> {
        const safeEvent = redactAgentEvent(event);
        dependencies.events.append(taskId, safeEvent);
        await renderer.handle(safeEvent).catch(error => {
          console.warn('[taskCoordinator] Failed to render task event:', redactErrorMessage(error));
        });

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
    await finishRendererSafely(renderer, safeStored);
    return dependencies.tasks.findById(taskId)!;
  }

  async function finalizeTask(
    taskId: string,
    result: TaskResult,
    renderer: TaskRenderer,
    reservationId?: string,
  ): Promise<TaskRecord> {
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
    const safeResult = redactTaskResult(storedResult);
    dependencies.tasks.saveResult(taskId, safeResult);
    if (reservationId && dependencies.usage) dependencies.usage.complete(reservationId, safeResult);
    activeReservations.delete(taskId);
    interruptionRequested.delete(taskId);
    await finishRendererSafely(renderer, safeResult);
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
    if (!task.providerSessionId) throw new Error('Task has no provider session to continue');
    const worktree = dependencies.tasks.getWorktree(task.id);
    if (!worktree || worktree.removedAt) throw new Error('Task worktree is no longer available');
    const project = dependencies.projects.findByName(task.projectName);
    if (!project) throw new Error(`Project "${task.projectName}" not found`);
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
      renderer.start(input.thread);
      await executeTurn({
        taskId: task.id,
        project,
        provider,
        prompt: input.prompt,
        thread: input.thread,
        workingDirectory: worktree.worktreePath,
        renderer,
        broker,
        model: input.model ?? project.models?.[task.provider],
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
      const validated = await validateProjectProvider(input.projectName, input.provider);
      const reservation = await dependencies.usage?.reserve({ provider: validated.providerId, prompt: input.prompt });
      try {
        const thread = await input.message.startThread({
          name: input.prompt.slice(0, 100),
          autoArchiveDuration: 60,
        });
        return await startNewTask({ ...validated, prompt: input.prompt, thread, model: input.model, reservationId: reservation?.id });
      } catch (error) {
        if (reservation && dependencies.usage) {
          try { dependencies.usage.release(reservation.id); } catch { /* already consumed or released */ }
        }
        throw error;
      }
    },

    async startInExistingThread(input: StartInExistingThreadInput): Promise<TaskRecord> {
      const validated = await validateProjectProvider(input.projectName, input.provider);
      const reservation = await dependencies.usage?.reserve({ provider: validated.providerId, prompt: input.prompt });
      try {
        return await startNewTask({ ...validated, prompt: input.prompt, thread: input.thread, model: input.model, reservationId: reservation?.id });
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
      });
    },

    continueInThread(input: ContinueInThreadInput): Promise<void> {
      return continueInThreadInternal(input);
    },

    async cancelByThread(threadId: string): Promise<boolean> {
      const task = dependencies.tasks.findByThreadId(threadId);
      if (!task || TERMINAL_STATUSES.has(task.status)) return false;
      const provider = dependencies.providers.require(task.provider);
      await provider.cancelTask(task.providerSessionId ?? task.id);
      const current = dependencies.tasks.findById(task.id);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        dependencies.tasks.transition(task.id, [current.status], 'cancelled');
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
      const parent = sourceThread.parent;
      if (!parent || !('threads' in parent) || !parent.threads || typeof parent.threads.create !== 'function') {
        throw new Error('The source thread parent cannot create a sibling thread');
      }
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
        sibling = await (parent.threads.create as (options: { name: string; autoArchiveDuration: 60 }) => Promise<AnyThreadChannel>)({ name: `${targetProvider}: ${source.objective}`.slice(0, 100), autoArchiveDuration: 60 });
        const created = await startNewTask({ project, provider, providerId: targetProvider, prompt, thread: sibling, baseBranch: sourceWorktree.branchName, reservationId: reservation?.id });
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
  };
}

async function finishRendererSafely(renderer: TaskRenderer, result: TaskResult): Promise<void> {
  await renderer.finish(result).catch(error => {
    console.warn('[taskCoordinator] Failed to render terminal task result:', redactErrorMessage(error));
  });
}

function runningGate(): RunningGate {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

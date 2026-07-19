import type { AnyThreadChannel } from 'discord.js';
import type {
  LoopRepository,
  ScheduledLoopRecord,
} from '../repositories/loopRepository.js';
import type { Project } from '../types.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface ScheduledLoopExecutionResult {
  readonly terminalReason?: string;
}

export interface ScheduledLoopServiceOptions {
  readonly repository: LoopRepository;
  readonly fetchThread: (threadId: string) => Promise<AnyThreadChannel | null>;
  readonly findProject: (projectName: string) => Project | undefined;
  readonly executeIteration: (
    loop: ScheduledLoopRecord,
    project: Project,
    thread: AnyThreadChannel,
  ) => Promise<ScheduledLoopExecutionResult | void>;
  readonly schedule?: (
    callback: () => Promise<void>,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly now?: () => number;
  readonly logger?: (message: string) => void;
}

export interface ScheduledLoopService {
  start(
    loop: ScheduledLoopRecord,
    project: Project,
    thread: AnyThreadChannel,
  ): Promise<void>;
  reconcile(): Promise<void>;
  runNow(loopId: string): Promise<void>;
  stopByChannel(channelId: string, reason: string): ScheduledLoopRecord | undefined;
  terminalizeByThread(threadId: string, reason: string): ScheduledLoopRecord | undefined;
  terminalizeByChannel(channelId: string, reason: string): ScheduledLoopRecord | undefined;
  terminalizeByProject(projectName: string, reason: string): ScheduledLoopRecord[];
  findActiveByChannelId(channelId: string): ScheduledLoopRecord | undefined;
  findActiveByThreadId(threadId: string): ScheduledLoopRecord | undefined;
  detachAll(): void;
  runtimeCount(): number;
}

interface RuntimeLoop {
  readonly id: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly project: Project;
  readonly thread: AnyThreadChannel;
  timer?: ReturnType<typeof setTimeout>;
  executing: boolean;
}

export function createScheduledLoopService(
  options: ScheduledLoopServiceOptions,
): ScheduledLoopService {
  const schedule = options.schedule
    ?? ((callback, delayMs) => setTimeout(() => { void callback(); }, delayMs));
  const clearSchedule = options.clearSchedule ?? clearTimeout;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? (message => console.warn(message));
  const runtimes = new Map<string, RuntimeLoop>();
  const runtimeByChannel = new Map<string, string>();
  const runtimeByThread = new Map<string, string>();

  function detach(loopId: string): void {
    const runtime = runtimes.get(loopId);
    if (!runtime) return;
    if (runtime.timer !== undefined) clearSchedule(runtime.timer);
    runtimes.delete(loopId);
    runtimeByChannel.delete(runtime.channelId);
    runtimeByThread.delete(runtime.threadId);
  }

  function register(
    loop: ScheduledLoopRecord,
    project: Project,
    thread: AnyThreadChannel,
  ): RuntimeLoop {
    const existing = runtimes.get(loop.id);
    if (existing) return existing;
    const runtime: RuntimeLoop = {
      id: loop.id,
      channelId: loop.channelId,
      threadId: loop.threadId,
      project,
      thread,
      executing: false,
    };
    runtimes.set(loop.id, runtime);
    runtimeByChannel.set(loop.channelId, loop.id);
    runtimeByThread.set(loop.threadId, loop.id);
    return runtime;
  }

  function scheduleRuntime(runtime: RuntimeLoop, delayMs: number): void {
    if (runtime.timer !== undefined) clearSchedule(runtime.timer);
    runtime.timer = schedule(async () => {
      const firedTimer = runtime.timer;
      runtime.timer = undefined;
      if (firedTimer !== undefined) clearSchedule(firedTimer);
      await runNow(runtime.id);
    }, Math.max(0, delayMs));
  }

  async function runNow(loopId: string): Promise<void> {
    const runtime = runtimes.get(loopId);
    if (!runtime || runtime.executing) return;
    if (runtime.timer !== undefined) {
      clearSchedule(runtime.timer);
      runtime.timer = undefined;
    }

    const acquired = options.repository.acquireIteration(loopId, now());
    if (!acquired) {
      detach(loopId);
      return;
    }

    runtime.executing = true;
    let result: ScheduledLoopExecutionResult | void;
    try {
      result = await options.executeIteration(acquired, runtime.project, runtime.thread);
    } catch (error) {
      logger(`[loop] Iteration ${acquired.iteration} for ${acquired.id} failed: ${redactErrorMessage(error)}`);
    } finally {
      runtime.executing = false;
    }

    if (result?.terminalReason) {
      options.repository.terminalizeById(loopId, result.terminalReason, now());
      detach(loopId);
      logger(`[loop] Terminalized ${loopId}: ${result.terminalReason}`);
      return;
    }

    const current = options.repository.findById(loopId);
    if (!current || current.status !== 'running') {
      detach(loopId);
      return;
    }

    const nextRunAt = now() + acquired.intervalMs;
    const waiting = options.repository.scheduleNext(loopId, nextRunAt, now());
    if (!waiting) {
      detach(loopId);
      return;
    }
    scheduleRuntime(runtime, acquired.intervalMs);
  }

  async function reconcileOne(loop: ScheduledLoopRecord): Promise<void> {
    if (runtimes.has(loop.id)) return;
    const project = options.findProject(loop.projectName);
    if (!project) {
      const reason = `Project "${loop.projectName}" is unavailable or archived`;
      options.repository.terminalizeById(loop.id, reason, now());
      logger(`[loop] Terminalized ${loop.id}: ${reason}`);
      return;
    }

    let thread: AnyThreadChannel | null = null;
    try {
      thread = await options.fetchThread(loop.threadId);
    } catch (error) {
      logger(`[loop] Failed to fetch thread ${loop.threadId}: ${redactErrorMessage(error)}`);
    }
    if (!thread) {
      const reason = `Discord thread ${loop.threadId} is unavailable`;
      options.repository.terminalizeById(loop.id, reason, now());
      logger(`[loop] Terminalized ${loop.id}: ${reason}`);
      return;
    }

    let resumable = loop;
    if (loop.status === 'running') {
      const nextRunAt = now() + loop.intervalMs;
      const deferred = options.repository.deferInterrupted(loop.id, nextRunAt, now());
      if (!deferred) return;
      resumable = deferred;
      logger(
        `[loop] Loop ${loop.id} was interrupted during iteration ${loop.iteration}; `
        + `the provider turn was not replayed and the next run was deferred by ${loop.intervalMs}ms.`,
      );
    }

    const runtime = register(resumable, project, thread);
    const dueAt = resumable.nextRunAt ?? now();
    scheduleRuntime(runtime, Math.max(0, dueAt - now()));
  }

  return {
    async start(loop, project, thread): Promise<void> {
      register(loop, project, thread);
      await runNow(loop.id);
    },

    async reconcile(): Promise<void> {
      for (const loop of options.repository.listResumable()) {
        await reconcileOne(loop);
      }
    },

    runNow,

    stopByChannel(channelId, reason): ScheduledLoopRecord | undefined {
      const stopped = options.repository.stopByChannel(channelId, reason, now());
      if (stopped) detach(stopped.id);
      return stopped;
    },

    terminalizeByThread(threadId, reason): ScheduledLoopRecord | undefined {
      const terminal = options.repository.terminalizeByThread(threadId, reason, now());
      if (terminal) detach(terminal.id);
      return terminal;
    },

    terminalizeByChannel(channelId, reason): ScheduledLoopRecord | undefined {
      const terminal = options.repository.terminalizeByChannel(channelId, reason, now());
      if (terminal) detach(terminal.id);
      return terminal;
    },

    terminalizeByProject(projectName, reason): ScheduledLoopRecord[] {
      const terminal = options.repository.terminalizeByProject(projectName, reason, now());
      for (const loop of terminal) detach(loop.id);
      return terminal;
    },

    findActiveByChannelId(channelId): ScheduledLoopRecord | undefined {
      return options.repository.findActiveByChannelId(channelId);
    },

    findActiveByThreadId(threadId): ScheduledLoopRecord | undefined {
      return options.repository.findActiveByThreadId(threadId);
    },

    detachAll(): void {
      for (const loopId of [...runtimes.keys()]) detach(loopId);
    },

    runtimeCount(): number {
      return runtimes.size;
    },
  };
}

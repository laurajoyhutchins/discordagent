import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createLoopRepository, type ScheduledLoopRecord } from '../repositories/loopRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import type { Project } from '../types.js';
import { createScheduledLoopService } from './scheduledLoopService.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude',
};

function setup(options: {
  now?: number;
  fetchThread?: (id: string) => Promise<AnyThreadChannel | null>;
  findProject?: (name: string) => Project | undefined;
  executeIteration?: (
    loop: ScheduledLoopRecord,
    project: Project,
    thread: AnyThreadChannel,
  ) => Promise<{ terminalReason?: string } | void>;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-loop-service-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);
  const projects = createProjectRepository(db);
  projects.create(project);
  const loops = createLoopRepository(db);
  const thread = { id: 'thread-1' } as AnyThreadChannel;
  let now = options.now ?? 10_000;
  let timerId = 0;
  const scheduled = new Map<number, { callback: () => Promise<void>; delayMs: number }>();
  const schedule = vi.fn((callback: () => Promise<void>, delayMs: number) => {
    timerId += 1;
    scheduled.set(timerId, { callback, delayMs });
    return timerId as unknown as ReturnType<typeof setTimeout>;
  });
  const clearSchedule = vi.fn((id: ReturnType<typeof setTimeout>) => {
    scheduled.delete(id as unknown as number);
  });
  const executeIteration = vi.fn(options.executeIteration ?? (async () => undefined));
  const fetchThread = vi.fn(options.fetchThread ?? (async (id: string) => (
    id === thread.id ? thread : null
  )));
  const findProject = vi.fn(options.findProject ?? ((name: string) => (
    name === project.name ? project : undefined
  )));
  const logger = vi.fn();
  const service = createScheduledLoopService({
    repository: loops,
    fetchThread,
    findProject,
    executeIteration,
    schedule,
    clearSchedule,
    now: () => now,
    logger,
  });
  return {
    loops,
    service,
    thread,
    scheduled,
    schedule,
    clearSchedule,
    executeIteration,
    fetchThread,
    findProject,
    logger,
    setNow(value: number) { now = value; },
  };
}

function createLoop(
  loops: ReturnType<typeof createLoopRepository>,
  overrides: Partial<Parameters<typeof loops.create>[0]> = {},
) {
  return loops.create({
    id: 'loop-1',
    projectName: 'factory-floor',
    channelId: 'agent-1',
    threadId: 'thread-1',
    prompt: 'run the tests',
    intervalMs: 60_000,
    startedBy: 'user-1',
    startedAt: 1_000,
    ...overrides,
  });
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('ScheduledLoopService reconciliation', () => {
  it('schedules one future timer and does not duplicate it on repeated reconciliation', async () => {
    const state = setup({ now: 10_000 });
    createLoop(state.loops);
    state.loops.acquireIteration('loop-1', 2_000);
    state.loops.scheduleNext('loop-1', 70_000, 2_100);

    await state.service.reconcile();
    await state.service.reconcile();

    expect(state.schedule).toHaveBeenCalledOnce();
    expect([...state.scheduled.values()][0]?.delayMs).toBe(60_000);
    expect(state.executeIteration).not.toHaveBeenCalled();
  });

  it('runs one immediate iteration for all missed intervals instead of bursting catch-up work', async () => {
    const state = setup({ now: 200_000 });
    createLoop(state.loops);
    state.loops.acquireIteration('loop-1', 2_000);
    state.loops.scheduleNext('loop-1', 70_000, 2_100);

    await state.service.reconcile();
    expect([...state.scheduled.values()][0]?.delayMs).toBe(0);

    const due = [...state.scheduled.values()][0]!;
    await due.callback();

    expect(state.executeIteration).toHaveBeenCalledOnce();
    expect(state.executeIteration.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      iteration: 2,
      status: 'running',
    }));
    expect(state.loops.findActiveByChannelId('agent-1')).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 2,
      nextRunAt: 260_000,
    }));
    expect(state.schedule).toHaveBeenCalledTimes(2);
    expect([...state.scheduled.values()][0]?.delayMs).toBe(60_000);
  });

  it('defers a crash-interrupted running iteration without replaying it', async () => {
    const state = setup({ now: 200_000 });
    createLoop(state.loops);
    state.loops.acquireIteration('loop-1', 2_000);

    await state.service.reconcile();

    expect(state.executeIteration).not.toHaveBeenCalled();
    expect(state.loops.findActiveByChannelId('agent-1')).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 1,
      nextRunAt: 260_000,
    }));
    expect([...state.scheduled.values()][0]?.delayMs).toBe(60_000);
    expect(state.logger).toHaveBeenCalledWith(expect.stringMatching(/interrupted.*not replayed/i));
  });

  it('terminalizes inaccessible or orphaned Discord surfaces instead of retrying forever', async () => {
    const missingThread = setup({
      fetchThread: async () => null,
    });
    createLoop(missingThread.loops);

    await missingThread.service.reconcile();

    expect(missingThread.loops.findById('loop-1')).toEqual(expect.objectContaining({
      status: 'terminal',
      stopReason: expect.stringMatching(/thread.*unavailable/i),
    }));
    expect(missingThread.schedule).not.toHaveBeenCalled();

    const missingProject = setup({
      findProject: () => undefined,
    });
    createLoop(missingProject.loops);

    await missingProject.service.reconcile();

    expect(missingProject.loops.findById('loop-1')).toEqual(expect.objectContaining({
      status: 'terminal',
      stopReason: expect.stringMatching(/project.*unavailable/i),
    }));
    expect(missingProject.fetchThread).not.toHaveBeenCalled();
  });
});

describe('ScheduledLoopService execution lifecycle', () => {
  it('never overlaps iterations and schedules only after the current execution completes', async () => {
    let finish!: () => void;
    const state = setup({
      executeIteration: () => new Promise<void>(resolve => { finish = resolve; }),
    });
    const loop = createLoop(state.loops);

    const running = state.service.start(loop, project, state.thread);
    await vi.waitFor(() => expect(state.executeIteration).toHaveBeenCalledOnce());
    expect(state.schedule).not.toHaveBeenCalled();

    await state.service.runNow('loop-1');
    expect(state.executeIteration).toHaveBeenCalledOnce();

    finish();
    await running;

    expect(state.schedule).toHaveBeenCalledOnce();
    expect(state.loops.findActiveByChannelId('agent-1')).toEqual(expect.objectContaining({
      iteration: 1,
      status: 'active',
      nextRunAt: 70_000,
    }));
  });

  it('terminalizes when the execution boundary reports an unavailable surface', async () => {
    const state = setup({
      executeIteration: async () => ({ terminalReason: 'Discord thread cannot receive messages' }),
    });
    const loop = createLoop(state.loops);

    await state.service.start(loop, project, state.thread);

    expect(state.loops.findById('loop-1')).toEqual(expect.objectContaining({
      status: 'terminal',
      stopReason: 'Discord thread cannot receive messages',
    }));
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('stops and terminalizes idempotently while cancelling the one owned timer', async () => {
    const state = setup();
    const loop = createLoop(state.loops);
    await state.service.start(loop, project, state.thread);
    expect(state.schedule).toHaveBeenCalledOnce();

    expect(state.service.stopByChannel('agent-1', 'Stopped by user')).toEqual(
      expect.objectContaining({ status: 'stopped' }),
    );
    expect(state.service.stopByChannel('agent-1', 'duplicate stop')).toBeUndefined();
    expect(state.clearSchedule).toHaveBeenCalledOnce();

    createLoop(state.loops, {
      id: 'loop-2',
      threadId: 'thread-2',
      startedAt: 20_000,
    });
    expect(state.service.terminalizeByProject('factory-floor', 'Project archived')).toEqual([
      expect.objectContaining({ id: 'loop-2', status: 'terminal' }),
    ]);
    expect(state.service.terminalizeByThread('thread-2', 'duplicate thread deletion')).toBeUndefined();
  });

  it('detaches timers for shutdown without changing durable active state', async () => {
    const state = setup();
    const loop = createLoop(state.loops);
    await state.service.start(loop, project, state.thread);

    state.service.detachAll();

    expect(state.clearSchedule).toHaveBeenCalledOnce();
    expect(state.loops.findActiveByChannelId('agent-1')).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 1,
    }));
    expect(state.service.runtimeCount()).toBe(0);
  });
});

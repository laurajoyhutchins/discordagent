import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createLoopRepository } from '../repositories/loopRepository.js';
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

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-loop-failure-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);
  createProjectRepository(db).create(project);
  const loops = createLoopRepository(db);
  const thread = { id: 'thread-1' } as AnyThreadChannel;
  let now = 10_000;
  const schedule = vi.fn((callback: () => Promise<void>, delayMs: number) => (
    { callback, delayMs } as unknown as ReturnType<typeof setTimeout>
  ));
  const executeIteration = vi.fn(async () => {
    throw new Error('provider task launch failed');
  });
  const service = createScheduledLoopService({
    repository: loops,
    fetchThread: async () => thread,
    findProject: name => name === project.name ? project : undefined,
    executeIteration,
    schedule,
    clearSchedule: vi.fn(),
    now: () => now,
    logger: vi.fn(),
  });
  const createLoop = () => loops.create({
    id: 'loop-1',
    projectName: project.name,
    channelId: project.agentChannelId,
    threadId: thread.id,
    prompt: 'run the tests',
    intervalMs: 60_000,
    startedBy: 'user-1',
    startedAt: 1_000,
  });
  return {
    loops,
    service,
    schedule,
    thread,
    createLoop,
    setNow(value: number) { now = value; },
  };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('ScheduledLoopService iteration failures', () => {
  it('terminalizes a failed first iteration because no durable continuation exists', async () => {
    const state = setup();
    const loop = state.createLoop();

    await state.service.start(loop, project, state.thread);

    expect(state.loops.findById(loop.id)).toEqual(expect.objectContaining({
      status: 'terminal',
      iteration: 1,
      stopReason: expect.stringMatching(/initial.*failed/i),
    }));
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('keeps later iteration failures retryable on the normal cadence', async () => {
    const state = setup();
    const loop = state.createLoop();
    state.loops.acquireIteration(loop.id, 2_000);
    const waiting = state.loops.scheduleNext(loop.id, 70_000, 2_100)!;
    state.setNow(70_000);

    await state.service.start(waiting, project, state.thread);

    expect(state.loops.findById(loop.id)).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 2,
      nextRunAt: 130_000,
    }));
    expect(state.schedule).toHaveBeenCalledOnce();
  });
});

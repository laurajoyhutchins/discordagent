import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from './projectRepository.js';
import { createLoopRepository } from './loopRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-loops-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);
  const projects = createProjectRepository(db);
  projects.create({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  projects.create({
    name: 'reading',
    workingDirectory: '/repos/reading',
    categoryId: 'category-2',
    agentChannelId: 'agent-2',
    defaultProvider: 'codex',
  });
  return { db, projects, loops: createLoopRepository(db) };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const firstLoop = {
  id: 'loop-1',
  projectName: 'factory-floor',
  channelId: 'agent-1',
  threadId: 'thread-1',
  prompt: 'run the tests',
  intervalMs: 60_000,
  startedBy: 'user-1',
  startedAt: 1_000,
};

describe('LoopRepository', () => {
  it('creates, reads, acquires, schedules, and stops one durable loop', () => {
    const { loops } = setup();

    expect(loops.create(firstLoop)).toEqual({
      ...firstLoop,
      status: 'active',
      iteration: 0,
      nextRunAt: undefined,
      updatedAt: 1_000,
      stoppedAt: undefined,
      stopReason: undefined,
    });
    expect(loops.findActiveByChannelId('agent-1')?.id).toBe('loop-1');
    expect(loops.findActiveByThreadId('thread-1')?.id).toBe('loop-1');
    expect(loops.listResumable().map(loop => loop.id)).toEqual(['loop-1']);

    const running = loops.acquireIteration('loop-1', 2_000);
    expect(running).toEqual(expect.objectContaining({
      status: 'running',
      iteration: 1,
      updatedAt: 2_000,
    }));
    expect(running).not.toHaveProperty('nextRunAt');
    expect(loops.acquireIteration('loop-1', 2_001)).toBeUndefined();

    const waiting = loops.scheduleNext('loop-1', 62_000, 2_100);
    expect(waiting).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 1,
      nextRunAt: 62_000,
      updatedAt: 2_100,
    }));

    const stopped = loops.stopByChannel('agent-1', 'Stopped by user', 3_000);
    expect(stopped).toEqual(expect.objectContaining({
      status: 'stopped',
      stoppedAt: 3_000,
      stopReason: 'Stopped by user',
    }));
    expect(loops.findActiveByChannelId('agent-1')).toBeUndefined();
    expect(loops.stopByChannel('agent-1', 'duplicate stop', 3_001)).toBeUndefined();
  });

  it('allows a new loop after historical state terminalizes but rejects simultaneous active loops', () => {
    const { loops } = setup();
    loops.create(firstLoop);

    expect(() => loops.create({
      ...firstLoop,
      id: 'loop-duplicate',
      threadId: 'thread-duplicate',
    })).toThrow(/active scheduled loop.*agent-1/i);

    loops.stopByChannel('agent-1', 'done', 2_000);
    expect(loops.create({
      ...firstLoop,
      id: 'loop-2',
      threadId: 'thread-2',
      startedAt: 3_000,
    }).id).toBe('loop-2');
  });

  it('defers a crash-interrupted running loop without replaying its acquired iteration', () => {
    const { loops } = setup();
    loops.create(firstLoop);
    loops.acquireIteration('loop-1', 2_000);

    const deferred = loops.deferInterrupted('loop-1', 62_000, 2_100);

    expect(deferred).toEqual(expect.objectContaining({
      status: 'active',
      iteration: 1,
      nextRunAt: 62_000,
      updatedAt: 2_100,
    }));
    expect(loops.deferInterrupted('loop-1', 63_000, 2_200)).toBeUndefined();
  });

  it('terminalizes by thread, channel, project, or id with durable operator evidence', () => {
    const { loops } = setup();
    loops.create(firstLoop);
    loops.create({
      ...firstLoop,
      id: 'loop-reading',
      projectName: 'reading',
      channelId: 'agent-2',
      threadId: 'thread-2',
    });

    expect(loops.terminalizeByThread('thread-1', 'Discord thread deleted', 2_000)).toEqual(
      expect.objectContaining({ status: 'terminal', stopReason: 'Discord thread deleted' }),
    );
    expect(loops.terminalizeByChannel('agent-1', 'duplicate surface cleanup', 2_100)).toBeUndefined();
    expect(loops.terminalizeByProject('reading', 'Project archived', 2_200)).toEqual([
      expect.objectContaining({
        id: 'loop-reading',
        status: 'terminal',
        stopReason: 'Project archived',
      }),
    ]);

    loops.create({
      ...firstLoop,
      id: 'loop-3',
      threadId: 'thread-3',
      startedAt: 3_000,
    });
    expect(loops.terminalizeById('loop-3', 'Discord surface unavailable', 3_100)).toEqual(
      expect.objectContaining({ status: 'terminal', stopReason: 'Discord surface unavailable' }),
    );
    expect(loops.listResumable()).toEqual([]);
  });

  it('redacts sensitive prompt material before persistence', () => {
    const { db, loops } = setup();
    loops.create({
      ...firstLoop,
      prompt: 'Use token sk-proj-secret-value to run checks',
    });

    const stored = db.raw.prepare('SELECT prompt FROM scheduled_loops WHERE id = ?')
      .get('loop-1') as { prompt: string };
    expect(stored.prompt).not.toContain('sk-proj-secret-value');
    expect(stored.prompt).toContain('[REDACTED]');
  });
});

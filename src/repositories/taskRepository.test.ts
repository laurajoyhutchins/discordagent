import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, ProviderSession, TaskResult } from '../agents/contracts.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createEventRepository } from './eventRepository.js';
import { createProjectRepository } from './projectRepository.js';
import { createTaskRepository, type CreateTaskTransaction } from './taskRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-tasks-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'tasks.sqlite'));
  handles.push(db);
  runMigrations(db);
  createProjectRepository(db).create({
    name: 'factory-floor',
    workingDirectory: join(directory, 'factory-floor'),
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  return {
    db,
    tasks: createTaskRepository(db),
    events: createEventRepository(db),
  };
}

function transaction(
  id: string,
  overrides: Partial<CreateTaskTransaction> = {},
): CreateTaskTransaction {
  return {
    taskId: id,
    projectName: 'factory-floor',
    provider: 'claude',
    channelId: 'agent-1',
    threadId: `thread-${id}`,
    objective: `Objective ${id}`,
    worktree: {
      id: `worktree-${id}`,
      repositoryPath: '/repos/factory-floor',
      worktreePath: `/worktrees/${id}`,
      branchName: `agent/claude/${id}`,
      baseRef: 'main',
    },
    ...overrides,
  };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('TaskRepository', () => {
  it('creates task and worktree atomically and rolls both back on failure', () => {
    const { db, tasks } = setup();
    const created = tasks.createWithWorktree(transaction('task-one'));

    expect(created).toMatchObject({
      id: 'task-one',
      projectName: 'factory-floor',
      provider: 'claude',
      status: 'created',
      threadId: 'thread-task-one',
    });
    expect(tasks.findByThreadId('thread-task-one')).toEqual(created);
    expect(db.raw.prepare('SELECT task_id, branch_name FROM worktrees WHERE task_id = ?')
      .get('task-one')).toEqual({
      task_id: 'task-one',
      branch_name: 'agent/claude/task-one',
    });

    expect(() => tasks.createWithWorktree(transaction('task-two', {
      worktree: {
        id: 'worktree-task-two',
        repositoryPath: '/repos/factory-floor',
        worktreePath: '/worktrees/task-one',
        branchName: 'agent/claude/task-two',
        baseRef: 'main',
      },
    }))).toThrow();
    expect(db.raw.prepare('SELECT 1 FROM tasks WHERE id = ?').get('task-two')).toBeUndefined();
  });

  it('keeps provider identity immutable and attaches one matching provider session', () => {
    const { tasks } = setup();
    tasks.createWithWorktree(transaction('session-task'));

    const wrongProvider: ProviderSession = {
      provider: 'codex',
      sessionId: 'codex-session',
      createdAt: 10,
    };
    expect(() => tasks.attachProviderSession('session-task', wrongProvider))
      .toThrow(/provider.*match/i);

    const session: ProviderSession = {
      provider: 'claude',
      sessionId: 'claude-session',
      createdAt: 11,
    };
    tasks.attachProviderSession('session-task', session);
    expect(tasks.findByThreadId('thread-session-task')).toMatchObject({
      provider: 'claude',
      providerSessionId: 'claude-session',
    });
    expect(() => tasks.attachProviderSession('session-task', {
      ...session,
      sessionId: 'another-session',
    })).toThrow(/already.*session/i);
  });

  it('enforces legal compare-and-set lifecycle transitions', () => {
    const { tasks } = setup();
    tasks.createWithWorktree(transaction('lifecycle'));

    expect(tasks.transition('lifecycle', ['created'], 'starting').status).toBe('starting');
    expect(() => tasks.transition('lifecycle', ['created'], 'running')).toThrow(/stale/i);
    expect(tasks.transition('lifecycle', ['starting'], 'running')).toMatchObject({
      status: 'running',
      startedAt: expect.any(Number),
    });
    expect(tasks.transition('lifecycle', ['running'], 'waiting_for_user').status)
      .toBe('waiting_for_user');
    expect(tasks.transition('lifecycle', ['waiting_for_user'], 'running').status).toBe('running');
    expect(tasks.transition('lifecycle', ['running'], 'completed')).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Number),
    });
    expect(() => tasks.transition('lifecycle', ['completed'], 'running')).toThrow(/illegal/i);
  });

  it('lists only recoverable nonterminal tasks', () => {
    const { tasks } = setup();
    for (const id of ['starting', 'running', 'waiting', 'completed']) {
      tasks.createWithWorktree(transaction(id));
      tasks.transition(id, ['created'], 'starting');
    }
    tasks.transition('running', ['starting'], 'running');
    tasks.transition('waiting', ['starting'], 'running');
    tasks.transition('waiting', ['running'], 'waiting_for_user');
    tasks.transition('completed', ['starting'], 'running');
    tasks.transition('completed', ['running'], 'completed');

    expect(tasks.listRecoverable().map(task => task.id).sort()).toEqual([
      'running',
      'starting',
      'waiting',
    ]);
  });

  it('stores terminal results separately and rejects premature or mismatched results', () => {
    const { db, tasks } = setup();
    tasks.createWithWorktree(transaction('result-task'));
    tasks.transition('result-task', ['created'], 'starting');
    tasks.transition('result-task', ['starting'], 'running');

    const result: TaskResult = {
      provider: 'claude',
      outcome: 'completed',
      exitType: 'success',
      startedAt: 100,
      completedAt: 200,
      summary: 'Implemented the registry',
      usage: { inputTokens: 10, outputTokens: 4 },
    };
    expect(() => tasks.saveResult('result-task', result)).toThrow(/terminal/i);

    tasks.transition('result-task', ['running'], 'completed');
    expect(() => tasks.saveResult('result-task', { ...result, provider: 'codex' }))
      .toThrow(/provider.*match/i);
    tasks.saveResult('result-task', result);

    expect(db.raw.prepare('SELECT outcome, summary, usage_json FROM task_results WHERE task_id = ?')
      .get('result-task')).toEqual({
      outcome: 'completed',
      summary: 'Implemented the registry',
      usage_json: JSON.stringify(result.usage),
    });
    expect(() => tasks.saveResult('result-task', result)).toThrow(/already.*result/i);
  });
});

describe('EventRepository', () => {
  it('appends normalized events and deduplicates provider event keys', () => {
    const { tasks, events } = setup();
    tasks.createWithWorktree(transaction('event-task'));
    const text: AgentEvent = { type: 'text_delta', text: 'hello' };
    const status: AgentEvent = { type: 'status', phase: 'working', detail: 'reading files' };

    events.append('event-task', text);
    events.append('event-task', status, 'provider-event-1');
    events.append('event-task', status, 'provider-event-1');

    const stored = events.list('event-task');
    expect(stored).toHaveLength(2);
    expect(stored.map(entry => entry.event)).toEqual([text, status]);
    expect(stored[1].dedupeKey).toBe('provider-event-1');
    expect(stored[0].createdAt).toEqual(expect.any(Number));
  });
});

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

  it('persists the effective task settings snapshot', () => {
    const { tasks } = setup();
    const created = tasks.createWithWorktree(transaction('settings-task', {
      settings: { model: 'gpt-5-codex', reasoningEffort: 'high' },
    }));

    expect(created.settings).toEqual({ model: 'gpt-5-codex', reasoningEffort: 'high' });
    expect(tasks.findById('settings-task')?.settings).toEqual({
      model: 'gpt-5-codex',
      reasoningEffort: 'high',
    });
  });

  it('fails closed when a stored settings snapshot is malformed', () => {
    const { db, tasks } = setup();
    tasks.createWithWorktree(transaction('malformed-settings'));
    db.raw.prepare('UPDATE tasks SET settings_json = ? WHERE id = ?')
      .run('{"model":{"unexpected":"value"}}', 'malformed-settings');

    expect(tasks.findById('malformed-settings')?.settings).toEqual({});
    expect(tasks.findById('malformed-settings')?.settingsMalformed).toBe(true);
  });

  it('redacts task objectives before persistence and reload', () => {
    const { tasks } = setup();
    const created = tasks.createWithWorktree(transaction('redacted-objective', { objective: 'Deploy with API_KEY=objective-secret' }));

    expect(created.objective).toContain('[REDACTED]');
    expect(created.objective).not.toContain('objective-secret');
    expect(tasks.findById('redacted-objective')?.objective).not.toContain('objective-secret');
  });

  it('persists and reloads the Discord control-card message identity', () => {
    const { tasks } = setup();
    tasks.createWithWorktree(transaction('card-task'));

    tasks.saveControlCard('card-task', { messageId: 'message-1', pinState: 'not_pinned' });
    expect(tasks.getControlCard('card-task')).toMatchObject({
      taskId: 'card-task',
      messageId: 'message-1',
      pinState: 'not_pinned',
    });

    tasks.saveControlCard('card-task', { messageId: 'message-1', pinState: 'pinned' });
    expect(tasks.getControlCard('card-task')?.pinState).toBe('pinned');
  });

  it('fails closed when a stored timeout snapshot is outside the validated range', () => {
    const { db, tasks } = setup();
    tasks.createWithWorktree(transaction('out-of-range-timeout'));
    for (const timeoutMs of [4_999, 3_600_001]) {
      db.raw.prepare('UPDATE tasks SET settings_json = ? WHERE id = ?')
        .run(JSON.stringify({ timeoutMs }), 'out-of-range-timeout');

      expect(tasks.findById('out-of-range-timeout')?.settings).toEqual({});
    }
  });

  it('marks non-empty snapshots with unknown settings as malformed', () => {
    const { db, tasks } = setup();
    tasks.createWithWorktree(transaction('unknown-setting'));
    db.raw.prepare('UPDATE tasks SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ timeoutMs: 60_000, unexpected: true }), 'unknown-setting');

    expect(tasks.findById('unknown-setting')).toMatchObject({ settings: {}, settingsMalformed: true });
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
      verification: ['npm test: passed'],
      unresolved: ['Choose persistence backend'],
      usage: { inputTokens: 10, outputTokens: 4 },
    };
    expect(() => tasks.saveResult('result-task', result)).toThrow(/terminal/i);

    tasks.transition('result-task', ['running'], 'completed');
    expect(() => tasks.saveResult('result-task', { ...result, provider: 'codex' }))
      .toThrow(/provider.*match/i);
    tasks.saveResult('result-task', result);

    expect(db.raw.prepare('SELECT outcome, summary, verification_json, unresolved_json, usage_json FROM task_results WHERE task_id = ?')
      .get('result-task')).toEqual({
      outcome: 'completed',
      summary: 'Implemented the registry',
      verification_json: JSON.stringify(result.verification),
      unresolved_json: JSON.stringify(result.unresolved),
      usage_json: JSON.stringify(result.usage),
    });
    expect(() => tasks.saveResult('result-task', result)).toThrow(/already.*result/i);
  });

  it('retrieves worktree state, marks clean removal, and reopens a terminal task for continuation', () => {
    const { db, tasks } = setup();
    tasks.createWithWorktree(transaction('continuation'));
    tasks.attachProviderSession('continuation', {
      provider: 'claude', sessionId: 'session-continuation', createdAt: 10,
    });
    tasks.transition('continuation', ['created'], 'starting');
    tasks.transition('continuation', ['starting'], 'running');
    tasks.transition('continuation', ['running'], 'completed');
    tasks.saveResult('continuation', {
      provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 10, completedAt: 20,
    });

    expect(tasks.findById('continuation')).toMatchObject({ status: 'completed' });
    expect(tasks.getWorktree('continuation')).toMatchObject({
      taskId: 'continuation',
      branchName: 'agent/claude/continuation',
      worktreePath: '/worktrees/continuation',
    });

    expect(tasks.reopenForContinuation('continuation')).toMatchObject({
      status: 'starting',
      providerSessionId: 'session-continuation',
    });
    expect(db.raw.prepare('SELECT 1 FROM task_results WHERE task_id = ?').get('continuation'))
      .toBeUndefined();

    tasks.markWorktreeRemoved('continuation', 1234);
    expect(tasks.getWorktree('continuation')).toMatchObject({ removedAt: 1234 });
  });

  it('preserves the task settings snapshot when reopening for continuation', () => {
    const { tasks } = setup();
    tasks.createWithWorktree(transaction('settings-continuation', {
      settings: { model: 'gpt-5-codex', reasoningEffort: 'high' },
    }));
    tasks.attachProviderSession('settings-continuation', {
      provider: 'claude', sessionId: 'settings-session', createdAt: 10,
    });
    tasks.transition('settings-continuation', ['created'], 'starting');
    tasks.transition('settings-continuation', ['starting'], 'running');
    tasks.transition('settings-continuation', ['running'], 'completed');
    tasks.saveResult('settings-continuation', {
      provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 10, completedAt: 20,
    });

    expect(tasks.reopenForContinuation('settings-continuation').settings).toEqual({
      model: 'gpt-5-codex', reasoningEffort: 'high',
    });
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

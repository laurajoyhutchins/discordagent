import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnyThreadChannel, Message } from 'discord.js';
import type {
  AgentProvider,
  AgentRunHost,
  ContinueTaskInput,
  ProviderRun,
  StartTaskInput,
  TaskResult,
} from '../agents/contracts.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import type { InteractionBroker } from '../discord/interactionBroker.js';
import type { TaskControlSurface } from '../discord/taskControl.js';
import type { TaskRenderer } from '../discord/taskRenderer.js';
import type { CreatedWorktree, WorktreeManager } from '../git/worktreeManager.js';
import { createEventRepository } from '../repositories/eventRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/taskRepository.js';
import type { TaskRecord } from '../types.js';
import { createTaskCoordinator } from './taskCoordinator.js';

const directories: string[] = [];
const databases: DatabaseHandle[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((done, fail) => { resolve = done; reject = fail; }),
    resolve,
    reject,
  };
}

class FakeThread {
  readonly sent: unknown[] = [];
  constructor(
    readonly id = 'thread-123456',
    readonly parentId = 'agent-1',
  ) {}
  async send(payload: unknown) { this.sent.push(payload); return payload; }
}

class FakeMessage {
  readonly channelId = 'agent-1';
  readonly channel: AnyThreadChannel;
  startCount = 0;
  constructor(readonly taskThread: FakeThread, private readonly order?: string[]) {
    this.channel = taskThread as unknown as AnyThreadChannel;
  }
  async startThread(): Promise<AnyThreadChannel> {
    this.startCount += 1;
    this.order?.push('thread');
    return this.taskThread as unknown as AnyThreadChannel;
  }
}

class FakeRenderer implements TaskRenderer {
  readonly events: unknown[] = [];
  readonly results: TaskResult[] = [];
  started = false;
  start(): void { this.started = true; }
  async handle(event: unknown): Promise<void> { this.events.push(event); }
  async finish(result: TaskResult): Promise<void> { this.results.push(result); }
}

class FakeBroker implements InteractionBroker {
  approvals = 0;
  questions = 0;
  lastThread: AnyThreadChannel | null = null;
  lastApproval: unknown = null;
  async requestApproval(thread: AnyThreadChannel, request: unknown) {
    this.approvals += 1;
    this.lastThread = thread;
    this.lastApproval = request;
    return 'allow' as const;
  }
  async requestUserInput(thread: AnyThreadChannel) {
    this.questions += 1;
    this.lastThread = thread;
    return { skipped: false, values: ['A'] };
  }
}

class FakeProvider implements AgentProvider {
  readonly id = 'claude' as const;
  available = true;
  onAvailability?: () => void;
  readonly cancelled: string[] = [];
  startImpl?: (input: StartTaskInput, host: AgentRunHost) => Promise<ProviderRun>;
  continueImpl?: (input: ContinueTaskInput, host: AgentRunHost) => Promise<ProviderRun>;

  async checkAvailability() {
    this.onAvailability?.();
    return this.available ? { available: true } : { available: false, reason: 'Provider offline' };
  }
  async startTask(input: StartTaskInput, host: AgentRunHost) {
    if (!this.startImpl) throw new Error('startImpl not configured');
    return this.startImpl(input, host);
  }
  async continueTask(input: ContinueTaskInput, host: AgentRunHost) {
    if (!this.continueImpl) throw new Error('continueImpl not configured');
    return this.continueImpl(input, host);
  }
  async cancelTask(sessionId: string) { this.cancelled.push(sessionId); }
  async estimateHandoff() {
    return { estimatedInputTokens: 1, confidence: 'high' as const, explanation: 'test' };
  }
}

function completed(sessionId: string, overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    provider: 'claude',
    outcome: 'completed',
    exitType: 'success',
    startedAt: 10,
    completedAt: 20,
    sessionId,
    summary: 'Done',
    verification: ['tests passed'],
    ...overrides,
  };
}

function setup(order: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-coordinator-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'coordinator.sqlite'));
  databases.push(db);
  runMigrations(db);
  const baseProjects = createProjectRepository(db);
  baseProjects.create({
    name: 'factory-floor',
    workingDirectory: join(directory, 'factory-floor'),
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
    baseBranch: 'main',
  });
  const projects = {
    ...baseProjects,
    findByName(name: string) {
      order.push('project');
      return baseProjects.findByName(name);
    },
  };
  const baseTasks = createTaskRepository(db);
  const tasks: TaskRepository = {
    ...baseTasks,
    createWithWorktree(input) { order.push('persist'); return baseTasks.createWithWorktree(input); },
    attachProviderSession(taskId, session) { order.push('session'); baseTasks.attachProviderSession(taskId, session); },
    transition(taskId, expected, next) { order.push(next); return baseTasks.transition(taskId, expected, next); },
    saveResult(taskId, result) { order.push('result'); baseTasks.saveResult(taskId, result); },
  };
  const events = createEventRepository(db);
  const worktree: CreatedWorktree = {
    repositoryPath: join(directory, 'factory-floor'),
    worktreePath: join(directory, 'worktree'),
    branchName: 'agent/claude/task-123456',
    baseRef: 'main',
  };
  let removeCount = 0;
  const removedInputs: unknown[] = [];
  const worktrees: WorktreeManager = {
    async create() { order.push('worktree'); return worktree; },
    async inspect(path) { return { path, exists: true, dirty: false, branchName: worktree.branchName }; },
    async remove(input) { removeCount += 1; removedInputs.push(input); },
    async pruneAdministrativeMetadata() {},
  };
  const provider = new FakeProvider();
  provider.onAvailability = () => order.push('availability');
  const providers = new ProviderRegistry();
  providers.register(provider);
  const renderers: FakeRenderer[] = [];
  const broker = new FakeBroker();
  const controlUpdates: Array<{ status: TaskRecord['status']; result?: TaskResult }> = [];
  const controlSurface: TaskControlSurface = {
    async update(_thread, task, result) { controlUpdates.push({ status: task.status, ...(result ? { result } : {}) }); },
  };
  let id = 0;
  const coordinator = createTaskCoordinator({
    projects,
    tasks,
    events,
    worktrees,
    providers,
    rendererFactory: () => {
      const renderer = new FakeRenderer();
      renderers.push(renderer);
      return renderer;
    },
    brokerFactory: () => broker,
    controlSurface,
    idFactory: prefix => `${prefix}-${++id}`,
  });
  return {
    coordinator, tasks: baseTasks, events, provider, renderers, broker, controlSurface, controlUpdates,
    worktree, worktrees, removeCount: () => removeCount, removedInputs,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('TaskCoordinator', () => {
  it('persists worktree and provider session in the required order before awaiting completion', async () => {
    const order: string[] = [];
    const context = setup(order);
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async (_input, host) => {
      order.push('provider');
      await host.emit({ type: 'status', phase: 'working', detail: 'Inspecting files' });
      return {
        session: { provider: 'claude', sessionId: 'session-1', createdAt: 11 },
        completion: completion.promise,
      };
    };
    const thread = new FakeThread();
    const message = new FakeMessage(thread, order);

    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Implement registry', message: message as unknown as Message,
    });
    await waitUntil(() => order.includes('running'));
    expect(order.filter(item => [
      'project', 'availability', 'thread', 'worktree', 'persist', 'starting',
      'provider', 'session', 'running', 'completed', 'result',
    ].includes(item))).toEqual([
      'project', 'availability', 'thread', 'worktree', 'persist', 'starting',
      'provider', 'session', 'running',
    ]);
    expect(context.tasks.findByThreadId(thread.id)).toMatchObject({
      status: 'running', providerSessionId: 'session-1',
    });
    expect(context.events.list('task-1').map(entry => entry.event)).toContainEqual({
      type: 'status', phase: 'working', detail: 'Inspecting files',
    });

    completion.resolve(completed('session-1'));
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    expect(order.slice(-2)).toEqual(['completed', 'result']);
    expect(context.renderers[0].results[0]).toMatchObject({
      outcome: 'completed', branchName: context.worktree.branchName,
    });
    expect(context.controlUpdates.map(update => update.status)).toEqual([
      'starting', 'running', 'completed',
    ]);
    expect(context.controlUpdates.at(-1)?.result).toMatchObject({
      outcome: 'completed', branchName: context.worktree.branchName,
    });
  });

  it('rejects an unavailable provider before creating a Discord thread or worktree', async () => {
    const order: string[] = [];
    const context = setup(order);
    context.provider.available = false;
    const message = new FakeMessage(new FakeThread(), order);

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Do work', message: message as unknown as Message,
    })).rejects.toThrow(/offline/i);
    expect(message.startCount).toBe(0);
    expect(order).toEqual(['project', 'availability']);
  });

  it('moves into waiting_for_user for approvals and returns to running without losing the session', async () => {
    const order: string[] = [];
    const context = setup(order);
    context.provider.startImpl = async (_input, host) => ({
      session: { provider: 'claude', sessionId: 'approval-session', createdAt: 11 },
      completion: (async () => {
        const request = { id: 'approval-1', kind: 'command' as const, title: 'Bash', details: 'npm test' };
        await host.emit({ type: 'approval_request', request });
        expect(await host.requestApproval(request)).toBe('allow');
        return completed('approval-session');
      })(),
    });

    const task = await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Run tests',
      message: new FakeMessage(new FakeThread(), order) as unknown as Message,
    }).catch(async error => { throw error; });

    expect(task.status).toBe('completed');
    expect(order).toEqual(expect.arrayContaining(['waiting_for_user', 'running']));
    expect(context.controlUpdates.map(update => update.status)).toEqual([
      'starting', 'running', 'waiting_for_user', 'running', 'completed',
    ]);
    expect(context.broker.approvals).toBe(1);
    expect(context.broker.lastThread?.id).toBe('thread-123456');
    expect(context.events.list(task.id).map(entry => entry.event.type)).toContain('approval_request');
  });

  it('redacts sensitive provider events, approvals, and terminal results before persistence or Discord', async () => {
    const context = setup();
    context.provider.startImpl = async (_input, host) => ({
      session: { provider: 'claude', sessionId: 'redaction-session', createdAt: 11 },
      completion: (async () => {
        await host.emit({
          type: 'command',
          command: 'DISCORD_TOKEN=command-secret npm test',
          state: 'requested',
        });
        const request = {
          id: 'approval-secret',
          kind: 'command' as const,
          title: 'Run command',
          details: 'Authorization: Bearer approval-secret-value',
        };
        await host.emit({ type: 'approval_request', request });
        await host.requestApproval(request);
        return completed('redaction-session', { summary: 'API_KEY=result-secret' });
      })(),
    });

    const task = await context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'Redact secrets',
      message: new FakeMessage(new FakeThread('thread-redaction')) as unknown as Message,
    });

    const persisted = JSON.stringify(context.events.list(task.id));
    const rendered = JSON.stringify(context.renderers[0].events);
    const approval = JSON.stringify(context.broker.lastApproval);
    const result = JSON.stringify(context.renderers[0].results);
    for (const secret of ['command-secret', 'approval-secret-value', 'result-secret']) {
      expect(persisted).not.toContain(secret);
      expect(rendered).not.toContain(secret);
      expect(approval).not.toContain(secret);
      expect(result).not.toContain(secret);
    }
  });

  it('does not fail durable work when Discord task-control updates fail', async () => {
    const context = setup();
    context.controlSurface.update = async () => { throw new Error('Discord unavailable'); };
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'control-failure-session', createdAt: 11 },
      completion: Promise.resolve(completed('control-failure-session')),
    });

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Keep work independent from Discord rendering',
      message: new FakeMessage(new FakeThread('thread-control-failure')) as unknown as Message,
    })).resolves.toMatchObject({ status: 'completed' });
  });

  it('continues only with the immutable task provider and existing worktree/session', async () => {
    const context = setup();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'continue-session', createdAt: 11 },
      completion: Promise.resolve(completed('continue-session')),
    });
    const thread = new FakeThread('thread-continuation');
    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Initial work',
      message: new FakeMessage(thread) as unknown as Message,
    });

    await expect(context.coordinator.continueInThread({
      prompt: 'Continue', thread: thread as unknown as AnyThreadChannel, provider: 'codex',
    })).rejects.toThrow(/provider.*immutable/i);

    let continuedInput: ContinueTaskInput | undefined;
    context.provider.continueImpl = async input => {
      continuedInput = input;
      return { session: input.session, completion: Promise.resolve(completed(input.session.sessionId)) };
    };
    await context.coordinator.continueInThread({
      prompt: 'Continue', thread: thread as unknown as AnyThreadChannel,
    });

    expect(continuedInput).toMatchObject({
      session: { provider: 'claude', sessionId: 'continue-session' },
      workingDirectory: context.worktree.worktreePath,
    });
    expect(context.tasks.findByThreadId(thread.id)).toMatchObject({ status: 'completed' });
  });

  it('cancels the provider session, preserves the worktree, and records cancellation', async () => {
    const context = setup();
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'cancel-session', createdAt: 11 },
      completion: completion.promise,
    });
    const thread = new FakeThread('thread-cancel');
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Long task',
      message: new FakeMessage(thread) as unknown as Message,
    });
    await waitUntil(() => context.tasks.findByThreadId(thread.id)?.status === 'running');

    await expect(context.coordinator.cancelByThread(thread.id)).resolves.toBe(true);
    expect(context.provider.cancelled).toEqual(['cancel-session']);
    expect(context.removeCount()).toBe(0);
    expect(context.tasks.findByThreadId(thread.id)?.status).toBe('cancelled');

    completion.resolve(completed('cancel-session', {
      outcome: 'cancelled', exitType: 'cancelled', summary: 'Cancelled',
    }));
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
  });



  it('closes a terminal task by removing the clean worktree while preserving its branch', async () => {
    const context = setup();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'close-session', createdAt: 11 },
      completion: Promise.resolve(completed('close-session')),
    });
    const task = await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Closable task',
      message: new FakeMessage(new FakeThread('thread-close')) as unknown as Message,
    });

    await context.coordinator.closeTask(task.id);
    expect(context.removedInputs).toEqual([
      expect.objectContaining({
        worktreePath: context.worktree.worktreePath,
        branchName: context.worktree.branchName,
        removeBranch: false,
      }),
    ]);
    expect(context.tasks.getWorktree(task.id)?.removedAt).toEqual(expect.any(Number));
  });

  it('keeps a stored terminal result successful when the final Discord render fails', async () => {
    const context = setup();
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'render-failure-session', createdAt: 11 },
      completion: completion.promise,
    });
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'Finish despite Discord failure',
      message: new FakeMessage(new FakeThread('thread-render-failure')) as unknown as Message,
    });
    await waitUntil(() => context.renderers.length === 1);
    context.renderers[0].finish = async () => { throw new Error('Discord unavailable'); };

    completion.resolve(completed('render-failure-session'));

    await expect(running).resolves.toMatchObject({ status: 'completed' });
    expect(context.tasks.findByThreadId('thread-render-failure')?.status).toBe('completed');
  });

  it('marks the task failed when a provider completion promise rejects unexpectedly', async () => {
    const context = setup();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'reject-session', createdAt: 11 },
      completion: Promise.reject(new Error('transport disconnected')),
    });
    const thread = new FakeThread('thread-reject');

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Fragile task',
      message: new FakeMessage(thread) as unknown as Message,
    })).resolves.toMatchObject({ status: 'failed' });
    expect(context.tasks.findByThreadId(thread.id)).toMatchObject({ status: 'failed' });
    expect(context.renderers[0].results[0]).toMatchObject({
      outcome: 'failed', summary: 'transport disconnected',
    });
  });

  it('marks recoverable tasks interrupted, inspects worktrees, and never invokes a provider', async () => {
    const context = setup();
    for (const [id, status] of [['one', 'starting'], ['two', 'running'], ['three', 'waiting_for_user']] as const) {
      context.tasks.createWithWorktree({
        taskId: id,
        projectName: 'factory-floor',
        provider: 'claude',
        channelId: 'agent-1',
        threadId: `thread-${id}`,
        objective: id,
        worktree: {
          id: `worktree-${id}`,
          repositoryPath: '/repo',
          worktreePath: `/worktrees/${id}`,
          branchName: `agent/claude/${id}`,
          baseRef: 'main',
        },
      });
      context.tasks.transition(id, ['created'], 'starting');
      if (status === 'running' || status === 'waiting_for_user') {
        context.tasks.transition(id, ['starting'], 'running');
      }
      if (status === 'waiting_for_user') context.tasks.transition(id, ['running'], 'waiting_for_user');
    }

    const recovered = await context.coordinator.recoverInterruptedTasks();
    expect(recovered.map((task: TaskRecord) => task.status)).toEqual([
      'interrupted', 'interrupted', 'interrupted',
    ]);
    expect(context.provider.cancelled).toEqual([]);
    for (const task of recovered) {
      expect(context.events.list(task.id).at(-1)?.event).toMatchObject({
        type: 'status', phase: 'Recovery checkpoint',
      });
    }
  });
});

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
    idFactory: prefix => `${prefix}-${++id}`,
  });
  return {
    coordinator, tasks: baseTasks, events, provider, renderers, broker,
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
  });

  it('rejects an unavailable provider before creating a Discord thread or worktree', async () => {
    const order: string[] = [];
    const context = setup(order);
    context.provider.available = false;
    const message = new FakeMessage(new FakeThread(), order);

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Implement', message: message as unknown as Message,
    })).rejects.toThrow(/Provider offline/);
    expect(order).toEqual(['project', 'availability']);
    expect(message.startCount).toBe(0);
    expect(context.removeCount()).toBe(0);
  });

  it('removes an unpersisted clean worktree when provider startup fails', async () => {
    const context = setup();
    context.provider.startImpl = async () => { throw new Error('authentication failed'); };

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Implement',
      message: new FakeMessage(new FakeThread()) as unknown as Message,
    })) .rejects.toThrow(/authentication failed/);
    expect(context.removeCount()).toBe(1);
  });

  it('transitions to and from waiting_for_user for approvals and questions', async () => {
    const order: string[] = [];
    const context = setup(order);
    context.provider.startImpl = async (_input, host) => ({
      session: { provider: 'claude', sessionId: 'interactive-session', createdAt: 11 },
      completion: (async () => {
        await host.emit({
          type: 'approval_request',
          request: { id: 'approve-1', kind: 'command', title: 'npm test', details: 'npm test' },
        });
        await host.requestApproval({ id: 'approve-1', kind: 'command', title: 'npm test', details: 'npm test' });
        await host.emit({
          type: 'user_question',
          question: { id: 'q-1', prompt: 'Choose', options: [{ label: 'A', value: 'A' }] },
        });
        await host.requestUserInput({ id: 'q-1', prompt: 'Choose', options: [{ label: 'A', value: 'A' }] });
        return completed('interactive-session');
      })(),
    });

    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Ask',
      message: new FakeMessage(new FakeThread()) as unknown as Message,
    });

    expect(order.filter(item => ['waiting_for_user', 'running'].includes(item))).toEqual([
      'running', 'waiting_for_user', 'running',
      'waiting_for_user', 'running',
    ]);
    expect(context.broker.approvals).toBe(1);
    expect(context.broker.questions).toBe(1);
    expect(context.broker.lastThread).toBe(context.renderers[0] ? context.broker.lastThread : null);
  });

  it('redacts secrets before events are persisted, rendered, or brokered', async () => {
    const context = setup();
    context.provider.startImpl = async (_input, host) => ({
      session: { provider: 'claude', sessionId: 'redaction-session', createdAt: 11 },
      completion: (async () => {
        await host.emit({ type: 'command', command: 'echo command-secret', 
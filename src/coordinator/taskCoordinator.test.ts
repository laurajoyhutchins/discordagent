import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import type { TaskRenderer, TaskRenderContext } from '../discord/taskRenderer.js';
import type { CreatedWorktree, WorktreeManager } from '../git/worktreeManager.js';
import { createEventRepository } from '../repositories/eventRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/taskRepository.js';
import type { TaskRecord } from '../types.js';
import type { SettingsService } from '../services/settingsService.js';
import type { UsageAdmissionService } from '../services/usageAdmission.js';
import type { TaskCapabilityPreflight } from './capabilityPreflight.js';
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
  typingCalls = 0;
  constructor(
    readonly id = 'thread-123456',
    readonly parentId = 'agent-1',
  ) {}
  async send(payload: unknown) { this.sent.push(payload); return payload; }
  async sendTyping() { this.typingCalls += 1; }
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
  readonly cards: TaskRenderContext[] = [];
  started = false;
  disposeCount = 0;
  start(_thread?: AnyThreadChannel, context?: TaskRenderContext): void { this.started = true; if (context) this.cards.push(context); }
  async updateCard(context: TaskRenderContext): Promise<void> { this.cards.push(context); }
  async handle(event: unknown): Promise<void> { this.events.push(event); }
  async finish(result: TaskResult): Promise<void> { this.results.push(result); }
  async dispose(): Promise<void> { this.disposeCount += 1; }
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
  cancelImpl?: Promise<void>;

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
  async cancelTask(sessionId: string) { this.cancelled.push(sessionId); await this.cancelImpl; }
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

function setup(order: string[] = [], usage?: UsageAdmissionService, capabilityPreflight?: { assertCanUseTaskThread?: (channel: unknown) => void }) {
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
    async validateBaseBranch() { order.push('base-ref'); return 'main'; },
    async create() { order.push('worktree'); return worktree; },
    async inspect(path) { return { path, exists: true, dirty: false, branchName: worktree.branchName }; },
    async remove(input) { removeCount += 1; removedInputs.push(input); },
    async pruneAdministrativeMetadata() {},
  };
  const provider = new FakeProvider();
  provider.onAvailability = () => order.push('availability');
  const providers = new ProviderRegistry();
  providers.register(provider);
  const settingsService = {
    resolveTaskSettings: vi.fn(({ projectName, provider }: { projectName: string; provider: 'claude' | 'codex' }) => {
      const project = baseProjects.findByName(projectName);
      const result: Record<string, unknown> = {};
      const model = project?.models?.[provider];
      const reasoningEffort = provider === 'codex' ? project?.reasoningEfforts?.[provider] : undefined;
      if (model) result.model = model;
      if (reasoningEffort) result.reasoningEffort = reasoningEffort;
      return result;
    }),
  } as unknown as SettingsService;
  const renderers: FakeRenderer[] = [];
  const broker = new FakeBroker();
  let id = 0;
  const coordinator = createTaskCoordinator({
    projects,
    settings: settingsService,
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
    ...(usage ? { usage } : {}),
    ...(capabilityPreflight ? { capabilityPreflight: capabilityPreflight as TaskCapabilityPreflight } : {}),
  });
  return {
    coordinator, projects: baseProjects, tasks: baseTasks, events, provider, renderers, broker, settingsService,
    worktree, worktrees, removeCount: () => removeCount, removedInputs, database: db, providers,
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
  it('updates one renderer card across provider lifecycle transitions', async () => {
    const context = setup();
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async (_input, _host) => ({
      session: { provider: 'claude', sessionId: 'card-session', createdAt: 1 },
      completion: completion.promise,
    });
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'render lifecycle card',
      message: new FakeMessage(new FakeThread()) as unknown as Message,
    });
    await waitUntil(() => context.tasks.listActive().some(task => task.status === 'running'));
    const task = context.tasks.listActive()[0];
    expect(context.renderers[0].cards.map(card => card.task.status)).toEqual(expect.arrayContaining(['starting', 'running']));
    const active = context.tasks.findById(task.id);
    expect(active?.status).toBe('running');
    await context.coordinator.cancelByThread(task.threadId);
    completion.resolve({ provider: 'claude', outcome: 'cancelled', exitType: 'cancelled', startedAt: 1, completedAt: 2, summary: 'Cancelled' });
    await running;
    expect(context.renderers[0].cards.map(card => card.task.status)).toContain('cancelled');
  });

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
      'project', 'availability', 'base-ref', 'thread', 'worktree', 'persist', 'starting',
      'provider', 'session', 'running', 'completed', 'result',
    ].includes(item))).toEqual([
      'project', 'availability', 'base-ref', 'thread', 'worktree', 'persist', 'starting',
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
    expect(context.renderers[0].disposeCount).toBe(1);
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

  it('checks provider availability before resolving start settings', async () => {
    const context = setup();
    context.provider.available = false;
    const resolveSettings = vi.mocked(context.settingsService.resolveTaskSettings);
    resolveSettings.mockImplementation(() => { throw new Error('settings must not resolve'); });
    const message = new FakeMessage(new FakeThread());

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Unavailable provider', message: message as unknown as Message,
    })).rejects.toThrow(/offline/i);
    expect(resolveSettings).not.toHaveBeenCalled();
    expect(message.startCount).toBe(0);
  });

  it('does not create unsupported Claude reasoning settings at task start', async () => {
    const context = setup();
    context.projects.updateReasoning('factory-floor', 'claude', 'high');
    let startedInput: StartTaskInput | undefined;
    context.provider.startImpl = async (input) => {
      startedInput = input;
      return {
        session: { provider: 'claude', sessionId: 'reasoning-session', createdAt: 11 },
        completion: Promise.resolve(completed('reasoning-session')),
      };
    };

    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Use the configured reasoning depth',
      message: new FakeMessage(new FakeThread('thread-reasoning')) as unknown as Message,
    });

    expect(startedInput?.reasoningEffort).toBeUndefined();
  });

  it('resolves and persists effective global/project settings before provider start', async () => {
    const context = setup();
    const resolved = { model: 'resolved-project-model', timeoutMs: 60_000 };
    vi.mocked(context.settingsService.resolveTaskSettings).mockReturnValue(resolved);
    let startedInput: StartTaskInput | undefined;
    context.provider.startImpl = async input => {
      startedInput = input;
      return {
        session: { provider: 'claude', sessionId: 'settings-session', createdAt: 11 },
        completion: Promise.resolve(completed('settings-session')),
      };
    };

    const task = await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Use resolved settings',
      message: new FakeMessage(new FakeThread('thread-settings')) as unknown as Message,
    });

    expect(context.settingsService.resolveTaskSettings).toHaveBeenCalledWith({
      projectName: 'factory-floor', provider: 'claude',
      modelOverride: undefined, reasoningOverride: undefined,
    });
    expect(task.settings).toEqual(resolved);
    expect(startedInput?.settings).toEqual(resolved);
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
    expect(context.broker.approvals).toBe(1);
    expect(context.broker.lastThread?.id).toBe('thread-123456');
    expect(context.events.list(task.id).map(entry => entry.event.type)).toContain('approval_request');
  });

  it('shows typing indicator while waiting for provider completion and stops after', async () => {
    vi.useFakeTimers();
    const context = setup();
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async (_input, _host) => ({
      session: { provider: 'claude', sessionId: 'typing-session', createdAt: 1 },
      completion: completion.promise,
    });
    const thread = new FakeThread('thread-typing');
    const message = new FakeMessage(thread);

    context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Long running task',
      message: message as unknown as Message,
    });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(thread.typingCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(thread.typingCalls).toBe(2);

    completion.resolve(completed('typing-session'));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(thread.typingCalls).toBe(2);

    vi.useRealTimers();
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

    expect(context.settingsService.resolveTaskSettings).toHaveBeenCalledTimes(2);

    expect(continuedInput).toMatchObject({
      session: { provider: 'claude', sessionId: 'continue-session' },
      workingDirectory: context.worktree.worktreePath,
    });
    expect(context.tasks.findByThreadId(thread.id)).toMatchObject({ status: 'completed' });
  });

  it('layers a continuation model and reasoning override without changing the stored snapshot', async () => {
    const context = setup();
    vi.mocked(context.settingsService.resolveTaskSettings).mockReturnValue({
      model: 'snapshot-model', timeoutMs: 60_000,
    });
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'snapshot-session', createdAt: 11 },
      completion: Promise.resolve(completed('snapshot-session')),
    });
    const thread = new FakeThread('thread-snapshot');
    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Initial work',
      message: new FakeMessage(thread) as unknown as Message,
    });
    const before = context.tasks.findByThreadId(thread.id);

    let continuedInput: ContinueTaskInput | undefined;
    context.provider.continueImpl = async input => {
      continuedInput = input;
      return { session: input.session, completion: Promise.resolve(completed(input.session.sessionId)) };
    };
    await context.coordinator.continueInThread({
      prompt: 'Use a sharper model for this turn', thread: thread as unknown as AnyThreadChannel,
      model: 'one-turn-model',
    });

    expect(continuedInput).toMatchObject({
      settings: { model: 'snapshot-model', timeoutMs: 60_000 },
      turnSettings: { model: 'one-turn-model' },
    });
    expect(continuedInput?.settings).not.toBe(before?.settings);
    expect(context.tasks.findByThreadId(thread.id)?.settings).toEqual(before?.settings);
    expect(context.settingsService.resolveTaskSettings).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported continuation settings before reopening or reserving usage', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = {
      reserve,
      posture: vi.fn(() => ({ posture: 'normal' })),
    } as unknown as UsageAdmissionService;
    const context = setup([], usage);
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'terminal-session', createdAt: 11 },
      completion: Promise.resolve(completed('terminal-session')),
    });
    const thread = new FakeThread('thread-preflight');
    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Initial work',
      message: new FakeMessage(thread) as unknown as Message,
    });
    reserve.mockClear();

    const providerContinue = vi.fn<NonNullable<FakeProvider['continueImpl']>>();
    context.provider.continueImpl = providerContinue;
    await expect(context.coordinator.continueInThread({
      prompt: 'Unsupported Claude turn',
      thread: thread as unknown as AnyThreadChannel,
      reasoningEffort: 'high',
    })).rejects.toThrow(/Claude.*reasoningEffort.*support/i);

    expect(context.tasks.findByThreadId(thread.id)).toMatchObject({ status: 'completed' });
    expect(providerContinue).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects an incompatible durable snapshot before continuation side effects', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = {
      reserve,
      posture: vi.fn(() => ({ posture: 'normal' })),
    } as unknown as UsageAdmissionService;
    const order: string[] = [];
    const context = setup(order, usage);
    const task = context.tasks.createWithWorktree({
      taskId: 'incompatible-task', projectName: 'factory-floor', provider: 'claude',
      channelId: 'agent-1', threadId: 'thread-incompatible', objective: 'Existing task',
      settings: { reasoningEffort: 'high' },
      worktree: { id: 'worktree-incompatible', repositoryPath: '/repo', worktreePath: '/worktree', branchName: 'agent/claude/incompatible', baseRef: 'main' },
    });
    context.tasks.attachProviderSession(task.id, { provider: 'claude', sessionId: 'incompatible-session', createdAt: 1 });
    context.tasks.transition(task.id, ['created'], 'starting');
    context.tasks.transition(task.id, ['starting'], 'running');
    context.tasks.transition(task.id, ['running'], 'completed');

    const providerContinue = vi.fn<NonNullable<FakeProvider['continueImpl']>>();
    context.provider.continueImpl = providerContinue;
    await expect(context.coordinator.continueInThread({
      prompt: 'Continue incompatible task', thread: new FakeThread('thread-incompatible') as unknown as AnyThreadChannel,
    })).rejects.toThrow(/Claude.*reasoningEffort.*support/i);

    expect(context.tasks.findById(task.id)).toMatchObject({ status: 'completed' });
    expect(providerContinue).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(order).not.toContain('worktree');
  });

  it('rejects a malformed non-empty snapshot without adopting current settings', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = { reserve, posture: vi.fn(() => ({ posture: 'normal' })) } as unknown as UsageAdmissionService;
    const context = setup([], usage);
    const task = context.tasks.createWithWorktree({
      taskId: 'malformed-task', projectName: 'factory-floor', provider: 'claude',
      channelId: 'agent-1', threadId: 'thread-malformed', objective: 'Malformed task',
      settings: { model: 'snapshot-model' },
      worktree: { id: 'worktree-malformed', repositoryPath: '/repo', worktreePath: '/worktree', branchName: 'agent/claude/malformed', baseRef: 'main' },
    });
    context.database.raw.prepare('UPDATE tasks SET settings_json = ? WHERE id = ?').run('{"timeoutMs":1}', task.id);
    context.tasks.attachProviderSession(task.id, { provider: 'claude', sessionId: 'malformed-session', createdAt: 1 });
    context.tasks.transition(task.id, ['created'], 'starting');
    context.tasks.transition(task.id, ['starting'], 'running');
    context.tasks.transition(task.id, ['running'], 'completed');

    await expect(context.coordinator.continueInThread({
      prompt: 'Continue malformed task', thread: new FakeThread('thread-malformed') as unknown as AnyThreadChannel,
    })).rejects.toThrow(/malformed.*settings/i);
    expect(context.tasks.findById(task.id)).toMatchObject({ status: 'completed' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects an incompatible start snapshot before usage, thread, worktree, or provider effects', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = { reserve, posture: vi.fn(() => ({ posture: 'normal' })) } as unknown as UsageAdmissionService;
    const order: string[] = [];
    const context = setup(order, usage);
    vi.mocked(context.settingsService.resolveTaskSettings).mockReturnValue({ reasoningEffort: 'high' });
    const start = vi.fn<NonNullable<FakeProvider['startImpl']>>();
    context.provider.startImpl = start;
    const message = new FakeMessage(new FakeThread(), order);

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Unsupported start', message: message as unknown as Message,
    })).rejects.toThrow(/Claude.*reasoningEffort.*support/i);
    expect(reserve).not.toHaveBeenCalled();
    expect(message.startCount).toBe(0);
    expect(order).not.toContain('worktree');
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects incompatible handoff settings before usage or sibling creation', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = { reserve, posture: vi.fn(() => ({ posture: 'normal' })) } as unknown as UsageAdmissionService;
    const context = setup([], usage);
    const sourceThread = new FakeThread('thread-handoff');
    const siblingCreate = vi.fn(async () => new FakeThread('sibling-thread'));
    (sourceThread as unknown as { parent: unknown }).parent = { threads: { create: siblingCreate } };
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'handoff-session', createdAt: 11 },
      completion: Promise.resolve(completed('handoff-session')),
    });
    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Source', message: new FakeMessage(sourceThread) as unknown as Message,
    });
    reserve.mockClear();
    const target = {
      id: 'codex',
      checkAvailability: vi.fn(async () => ({ available: true })),
      startTask: vi.fn(),
      estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
    } as unknown as AgentProvider;
    context.providers.register(target);
    vi.mocked(context.settingsService.resolveTaskSettings).mockReturnValue({ timeoutMs: 60_000 });

    await expect(context.coordinator.handoffFromThread({ sourceThread: sourceThread as unknown as AnyThreadChannel, targetProvider: 'codex' }))
      .rejects.toThrow(/Codex.*timeoutMs.*support/i);
    expect(reserve).not.toHaveBeenCalled();
    expect(siblingCreate).not.toHaveBeenCalled();
    expect(target.checkAvailability).toHaveBeenCalledTimes(1);
  });

  it('runs Discord task capability preflight before continuation reservation or reopen', async () => {
    const reserve = vi.fn(async () => undefined);
    const usage = { reserve, posture: vi.fn(() => ({ posture: 'normal' })) } as unknown as UsageAdmissionService;
    const capabilityPreflight = { assertCanUseTaskThread: vi.fn(() => { throw new Error('task thread capability denied'); }) };
    const context = setup([], usage, capabilityPreflight);
    const task = context.tasks.createWithWorktree({
      taskId: 'capability-task', projectName: 'factory-floor', provider: 'claude',
      channelId: 'agent-1', threadId: 'thread-capability', objective: 'Capability task',
      settings: { model: 'snapshot-model' },
      worktree: { id: 'worktree-capability', repositoryPath: '/repo', worktreePath: '/worktree', branchName: 'agent/claude/capability', baseRef: 'main' },
    });
    context.tasks.attachProviderSession(task.id, { provider: 'claude', sessionId: 'capability-session', createdAt: 1 });
    context.tasks.transition(task.id, ['created'], 'starting');
    context.tasks.transition(task.id, ['starting'], 'running');
    context.tasks.transition(task.id, ['running'], 'completed');

    await expect(context.coordinator.continueInThread({
      prompt: 'Denied continuation', thread: new FakeThread('thread-capability') as unknown as AnyThreadChannel,
    })).rejects.toThrow(/capability denied/i);
    expect(capabilityPreflight.assertCanUseTaskThread).toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(context.tasks.findById(task.id)).toMatchObject({ status: 'completed' });
  });

  it('resolves safe defaults when continuing a legacy task with an empty snapshot', async () => {
    const context = setup();
    const resolved = { model: 'resolved-legacy-model', timeoutMs: 60_000 };
    vi.mocked(context.settingsService.resolveTaskSettings)
      .mockReturnValueOnce({})
      .mockReturnValueOnce(resolved);
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'legacy-session', createdAt: 11 },
      completion: Promise.resolve(completed('legacy-session')),
    });
    const thread = new FakeThread('thread-legacy');
    await context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Initial legacy work',
      message: new FakeMessage(thread) as unknown as Message,
    });

    let continuedInput: ContinueTaskInput | undefined;
    context.provider.continueImpl = async input => {
      continuedInput = input;
      return { session: input.session, completion: Promise.resolve(completed(input.session.sessionId)) };
    };
    await context.coordinator.continueInThread({
      prompt: 'Continue legacy work', thread: thread as unknown as AnyThreadChannel,
      model: 'turn-only-model',
    });

    expect(continuedInput).toMatchObject({
      settings: resolved,
      turnSettings: { model: 'turn-only-model' },
    });
    expect(context.tasks.findByThreadId(thread.id)?.settings).toBeUndefined();
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
    expect(context.renderers[0].disposeCount).toBe(1);

    completion.resolve(completed('cancel-session', {
      outcome: 'cancelled', exitType: 'cancelled', summary: 'Cancelled',
    }));
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('interrupts a provider as soon as a late startup session arrives after cancellation', async () => {
    const context = setup();
    const start = deferred<ProviderRun>();
    context.provider.startImpl = async () => start.promise;
    const thread = new FakeThread('thread-cancel-starting');
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Cancel before session',
      message: new FakeMessage(thread) as unknown as Message,
    });
    await waitUntil(() => context.tasks.findByThreadId(thread.id)?.status === 'starting');

    await expect(context.coordinator.cancelByThread(thread.id)).resolves.toBe(true);
    expect(context.provider.cancelled).toEqual([]);
    start.resolve({
      session: { provider: 'claude', sessionId: 'late-start-session', createdAt: 12 },
      completion: Promise.resolve(completed('late-start-session', { outcome: 'cancelled', exitType: 'cancelled' })),
    });
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(context.provider.cancelled).toEqual(['late-start-session']);
    expect(context.tasks.findByThreadId(thread.id)?.providerSessionId).toBeUndefined();
  });

  it('disposes the renderer immediately when provider cancellation never resolves', async () => {
    const context = setup();
    context.provider.cancelImpl = new Promise<void>(() => undefined);
    const completion = deferred<TaskResult>();
    context.provider.startImpl = async () => ({
      session: { provider: 'claude', sessionId: 'stuck-cancel-session', createdAt: 11 },
      completion: completion.promise,
    });
    const thread = new FakeThread('thread-stuck-cancel');
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor', prompt: 'Long task', message: new FakeMessage(thread) as unknown as Message,
    });
    await waitUntil(() => context.tasks.findByThreadId(thread.id)?.status === 'running');

    await expect(context.coordinator.cancelByThread(thread.id)).resolves.toBe(true);
    expect(context.tasks.findByThreadId(thread.id)?.status).toBe('cancelled');
    expect(context.renderers[0].disposeCount).toBe(1);
    completion.resolve(completed('stuck-cancel-session', { outcome: 'cancelled', exitType: 'cancelled' }));
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(context.renderers[0].results).toHaveLength(1);
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

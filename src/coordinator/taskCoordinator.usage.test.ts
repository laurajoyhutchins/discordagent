import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel, Message } from 'discord.js';
import type { AgentProvider, AgentRunHost, ProviderRun, StartTaskInput, TaskResult } from '../agents/contracts.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createEventRepository } from '../repositories/eventRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { createTaskRepository } from '../repositories/taskRepository.js';
import type { UsageReservation } from '../repositories/usageRepository.js';
import type { UsageAdmissionService, UsagePosture } from '../services/usageAdmission.js';
import { UsageAdmissionError } from '../services/usageAdmission.js';
import type { WorktreeManager } from '../git/worktreeManager.js';
import { createTaskCoordinator } from './taskCoordinator.js';

const directories: string[] = [];
const databases: DatabaseHandle[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}

function reservation(id = 'reservation-1'): UsageReservation {
  return {
    id,
    provider: 'claude',
    taskClass: 'contained_feature',
    low: 4,
    high: 8,
    confidence: 'low',
    status: 'active',
    createdAt: Date.now(),
  };
}

function fakeUsage(overrides: Partial<UsageAdmissionService> = {}): UsageAdmissionService {
  return {
    reserve: vi.fn(async () => reservation()),
    attach: vi.fn(),
    release: vi.fn(),
    complete: vi.fn(),
    recordUsage: vi.fn(),
    recordWindow: vi.fn(),
    posture: vi.fn(() => ({ posture: 'healthy' as UsagePosture, available: 100, reserved: 0 })),
    reservations: vi.fn(() => []),
    detail: vi.fn(() => 'healthy'),
    ...overrides,
  };
}

function setup(usage: UsageAdmissionService, capabilityPreflight?: { assertCanCreateTaskThread(channel: unknown): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-usage-coordinator-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'runtime.sqlite'));
  databases.push(db);
  runMigrations(db);
  const projects = createProjectRepository(db);
  projects.create({
    name: 'factory-floor',
    workingDirectory: join(directory, 'repo'),
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
  });
  const tasks = createTaskRepository(db);
  const events = createEventRepository(db);
  const provider: AgentProvider & { host?: AgentRunHost; cancelled: string[]; completion: ReturnType<typeof deferred<TaskResult>> } = {
    id: 'claude',
    cancelled: [],
    completion: deferred<TaskResult>(),
    async checkAvailability() { return { available: true }; },
    async startTask(_input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun> {
      this.host = host;
      return {
        session: { provider: 'claude', sessionId: 'session-1', createdAt: Date.now() },
        completion: this.completion.promise,
      };
    },
    async continueTask() { throw new Error('not used'); },
    async cancelTask(sessionId: string) { this.cancelled.push(sessionId); },
    async estimateHandoff() { return { estimatedInputTokens: 1, confidence: 'low', explanation: 'test' }; },
  };
  const providers = new ProviderRegistry();
  providers.register(provider);
  const createWorktree = vi.fn(async () => ({
    repositoryPath: join(directory, 'repo'),
    worktreePath: join(directory, 'worktree'),
    branchName: 'agent/claude/task-thread-1',
    baseRef: 'main',
  }));
  const worktrees: WorktreeManager = {
    create: createWorktree,
    async inspect(path) { return { path, exists: true, dirty: false, branchName: 'agent/claude/task-thread-1' }; },
    async remove() {},
    async pruneAdministrativeMetadata() {},
  };
  const thread = {
    id: 'thread-1',
    parentId: 'agent-1',
    async send() {},
  } as unknown as AnyThreadChannel;
  const startThread = vi.fn(async () => thread);
  const message = { startThread, channel: thread } as unknown as Message;
  const coordinator = createTaskCoordinator({
    projects,
    settings: { resolveTaskSettings: () => ({}) } as never,
    tasks,
    events,
    worktrees,
    providers,
    usage,
    ...(capabilityPreflight ? { capabilityPreflight } : {}),
    rendererFactory: () => ({ start() {}, async handle() {}, async finish() {} }),
    brokerFactory: () => ({
      async requestApproval() { return 'allow' as const; },
      async requestUserInput() { return { skipped: false, values: [] }; },
    }),
    idFactory: prefix => `${prefix}-1`,
  });
  return { coordinator, tasks, provider, createWorktree, startThread, message };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

describe('TaskCoordinator usage admission', () => {
  it('rejects Discord capability failures before reserving usage or creating task state', async () => {
    const usage = fakeUsage();
    const capabilityPreflight = {
      assertCanCreateTaskThread: vi.fn(() => { throw new Error('Create Public Threads is unavailable'); }),
    };
    const context = setup(usage, capabilityPreflight);

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'cannot start without Discord capability',
      message: context.message,
    })).rejects.toThrow(/Create Public Threads/);

    expect(capabilityPreflight.assertCanCreateTaskThread).toHaveBeenCalledOnce();
    expect(usage.reserve).not.toHaveBeenCalled();
    expect(context.startThread).not.toHaveBeenCalled();
    expect(context.createWorktree).not.toHaveBeenCalled();
  });

  it('rejects before creating a Discord thread or Git worktree', async () => {
    const usage = fakeUsage({
      reserve: vi.fn(async () => { throw new UsageAdmissionError('capacity unavailable', 'restricted', 'defer'); }),
    });
    const context = setup(usage);

    await expect(context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'repository-wide refactor',
      message: context.message,
    })).rejects.toThrow(/capacity unavailable/);

    expect(context.startThread).not.toHaveBeenCalled();
    expect(context.createWorktree).not.toHaveBeenCalled();
  });

  it('attaches the hold after persistence and calibrates it on completion', async () => {
    const usage = fakeUsage();
    const context = setup(usage);
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'implement a contained feature',
      message: context.message,
    });
    await waitUntil(() => context.tasks.findByThreadId('thread-1')?.status === 'running');
    const task = context.tasks.findByThreadId('thread-1')!;
    expect(usage.attach).toHaveBeenCalledWith('reservation-1', task.id);

    const result: TaskResult = {
      provider: 'claude',
      outcome: 'completed',
      exitType: 'success',
      startedAt: 1,
      completedAt: 2,
      sessionId: 'session-1',
      summary: 'done',
      usage: { totalTokens: 10_000 },
    };
    context.provider.completion.resolve(result);
    await running;
    expect(usage.complete).toHaveBeenCalledWith('reservation-1', expect.objectContaining({ outcome: 'completed' }));
  });

  it('records usage and interrupts at most once in preserve mode without removing the worktree', async () => {
    const usage = fakeUsage({
      posture: vi.fn(() => ({ posture: 'preserve' as const, available: 8, reserved: 0 })),
    });
    const context = setup(usage);
    const running = context.coordinator.startFromMessage({
      projectName: 'factory-floor',
      prompt: 'implement a feature',
      message: context.message,
    });
    await waitUntil(() => Boolean(context.provider.host));
    await context.provider.host!.emit({ type: 'usage', usage: { utilization: 94 } });
    await context.provider.host!.emit({ type: 'usage', usage: { utilization: 95 } });
    await waitUntil(() => context.provider.cancelled.length === 1);

    expect(usage.recordUsage).toHaveBeenCalledTimes(2);
    expect(context.provider.cancelled).toEqual(['session-1']);
    expect(context.tasks.getWorktree(context.tasks.findByThreadId('thread-1')!.id)?.removedAt).toBeUndefined();

    context.provider.completion.resolve({
      provider: 'claude', outcome: 'cancelled', exitType: 'cancelled', startedAt: 1, completedAt: 2,
      sessionId: 'session-1', summary: 'checkpointed',
    });
    await running;
  });
});

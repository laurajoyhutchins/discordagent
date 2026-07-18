import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { TaskRecord, WorktreeRecord } from '../types.js';
import { handleTaskControlButton, type TaskControlButtonDependencies } from './taskControlHandler.js';
import { taskControlCustomId } from './taskControlCard.js';

const task: TaskRecord = {
  id: 'task-secret-id',
  projectName: 'discord-agent',
  provider: 'codex',
  status: 'running',
  channelId: 'agent-1',
  threadId: 'thread-1',
  objective: 'Implement task controls',
  createdAt: 1,
  updatedAt: 2,
  providerSessionId: 'session-secret-id',
};

const worktree: WorktreeRecord = {
  id: 'worktree-1',
  taskId: task.id,
  repositoryPath: '/repo',
  worktreePath: '/repo/.worktrees/task',
  branchName: 'feat/task-controls',
  baseRef: 'main',
  createdAt: 1,
};

interface FakeTaskButtonInteraction {
  customId: string;
  channelId: string;
  channel: { isThread(): boolean };
  user: { id: string };
  guild: { members: { fetch: ReturnType<typeof vi.fn> } };
  deferred: boolean;
  replied: boolean;
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
}

function interaction(
  action: 'inspect' | 'cancel',
  options: { thread?: boolean } = {},
): FakeTaskButtonInteraction {
  return {
    customId: taskControlCustomId(action),
    channelId: 'thread-1',
    channel: { isThread: () => options.thread ?? true },
    user: { id: 'user-1' },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'member-1' })) } },
    deferred: false,
    replied: false,
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  };
}

function dependencies(overrides: Partial<TaskControlButtonDependencies> = {}): TaskControlButtonDependencies {
  return {
    tasks: {
      findByThreadId: vi.fn((_threadId: string) => task),
      getResult: vi.fn((_taskId: string) => ({
        provider: 'codex',
        outcome: 'completed',
        exitType: 'success',
        startedAt: 1,
        completedAt: 2,
        summary: 'Implemented successfully',
      })),
      getWorktree: vi.fn((_taskId: string) => worktree),
    } as Pick<TaskRepository, 'findByThreadId' | 'getResult' | 'getWorktree'>,
    coordinator: { cancelByThread: vi.fn(async (_threadId: string) => true) } as Pick<TaskCoordinator, 'cancelByThread'>,
    isAuthorized: vi.fn(() => true),
    ...overrides,
  };
}

describe('task control buttons', () => {
  it('returns a private task inspection without exposing internal identities', async () => {
    const button = interaction('inspect');
    const deps = dependencies();

    await expect(handleTaskControlButton(button as never, deps)).resolves.toBe(true);

    const payload = button.reply.mock.calls[0]?.[0];
    const serialized = JSON.stringify(payload);
    expect(payload).toMatchObject({ flags: MessageFlags.Ephemeral });
    expect(serialized).toContain('Implement task controls');
    expect(serialized).toContain('discord-agent');
    expect(serialized).toContain('codex');
    expect(serialized).toContain('feat/task-controls');
    expect(serialized).toContain('Implemented successfully');
    expect(serialized).not.toContain('task-secret-id');
    expect(serialized).not.toContain('session-secret-id');
  });

  it('delegates active cancellation to the coordinator for the current thread', async () => {
    const button = interaction('cancel');
    const deps = dependencies();

    await expect(handleTaskControlButton(button as never, deps)).resolves.toBe(true);

    expect(button.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(deps.coordinator.cancelByThread).toHaveBeenCalledWith('thread-1');
    expect(button.editReply).toHaveBeenCalledWith('Task cancelled.');
  });

  it('rejects terminal cancellation without invoking the coordinator', async () => {
    const button = interaction('cancel');
    const completedTask: TaskRecord = { ...task, status: 'completed' };
    const deps = dependencies({
      tasks: {
        findByThreadId: vi.fn((_threadId: string) => completedTask),
        getResult: vi.fn((_taskId: string) => undefined),
        getWorktree: vi.fn((_taskId: string) => worktree),
      } as Pick<TaskRepository, 'findByThreadId' | 'getResult' | 'getWorktree'>,
    });

    await handleTaskControlButton(button as never, deps);

    expect(deps.coordinator.cancelByThread).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledWith({
      content: 'This task is already completed.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects unauthorized users', async () => {
    const button = interaction('inspect');
    const deps = dependencies({ isAuthorized: vi.fn(() => false) });

    await handleTaskControlButton(button as never, deps);

    expect(deps.tasks.findByThreadId).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledWith({
      content: 'You are not authorized.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('fails closed for stale controls outside a known task thread', async () => {
    const button = interaction('inspect', { thread: false });
    const deps = dependencies();

    await handleTaskControlButton(button as never, deps);

    expect(deps.tasks.findByThreadId).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledWith({
      content: 'This task control is stale or outside its task thread.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
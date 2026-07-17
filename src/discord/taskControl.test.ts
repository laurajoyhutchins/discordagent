import { describe, expect, it, vi } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import type { TaskResult } from '../agents/contracts.js';
import type { TaskRecord } from '../types.js';
import {
  DiscordTaskControlSurface,
  buildTaskControlPayload,
  parseTaskControlCustomId,
  taskControlCustomId,
} from './taskControl.js';

const activeTask: TaskRecord = {
  id: 'task-1',
  projectName: 'factory-floor',
  provider: 'codex',
  status: 'running',
  channelId: 'agent-1',
  threadId: 'thread-1',
  objective: 'Implement generic Discord task controls',
  createdAt: 1,
  updatedAt: 2,
};

const completedTask: TaskRecord = {
  ...activeTask,
  status: 'completed',
  completedAt: 3,
};

const result: TaskResult = {
  provider: 'codex',
  outcome: 'completed',
  exitType: 'success',
  startedAt: 1,
  completedAt: 3,
  summary: 'Task controls are implemented.',
  branchName: 'agent/generic-discord-task-controls',
  verification: ['npm test: passed', 'npm run build: passed'],
};

function componentIds(payload: ReturnType<typeof buildTaskControlPayload>): string[] {
  return payload.components.flatMap(row => row.components.map(component => {
    const data = component.toJSON();
    return 'custom_id' in data ? data.custom_id : '';
  }));
}

function fakeThread(existingMessage?: {
  edit: ReturnType<typeof vi.fn>;
  components: Array<{ components: Array<{ customId: string }> }>;
}) {
  const send = vi.fn(async () => ({ id: 'new-card' }));
  const values = existingMessage ? [{ client: { user: { id: 'bot-1' } }, ...existingMessage }] : [];
  const fetch = vi.fn(async () => ({ values: () => values.values() }));
  return {
    id: 'thread-1',
    client: { user: { id: 'bot-1' } },
    messages: { fetch },
    send,
  } as unknown as AnyThreadChannel & {
    send: ReturnType<typeof vi.fn>;
    messages: { fetch: ReturnType<typeof vi.fn> };
  };
}

describe('task control custom IDs', () => {
  it('round-trips inspect and cancel actions without backend-specific data', () => {
    const customId = taskControlCustomId('cancel', 'task-123');

    expect(customId).toBe('task-control:cancel:task-123');
    expect(parseTaskControlCustomId(customId)).toEqual({ action: 'cancel', taskId: 'task-123' });
    expect(parseTaskControlCustomId('factory-floor:cancel:task-123')).toBeUndefined();
    expect(parseTaskControlCustomId('task-control:merge:task-123')).toBeUndefined();
  });
});

describe('task control payload', () => {
  it('offers inspect and cancel while a task is active', () => {
    const payload = buildTaskControlPayload(activeTask);

    expect(componentIds(payload)).toEqual([
      'task-control:inspect:task-1',
      'task-control:cancel:task-1',
    ]);
    expect(JSON.stringify(payload)).toContain('running');
    expect(JSON.stringify(payload)).not.toContain('Factory Floor');
  });

  it('removes cancellation and shows the durable result after completion', () => {
    const payload = buildTaskControlPayload(completedTask, result);

    expect(componentIds(payload)).toEqual(['task-control:inspect:task-1']);
    const text = JSON.stringify(payload);
    expect(text).toContain('Task controls are implemented.');
    expect(text).toContain('agent/generic-discord-task-controls');
    expect(text).toContain('Send a new message in this thread');
  });
});

describe('DiscordTaskControlSurface', () => {
  it('creates one control card when the thread has no existing card', async () => {
    const thread = fakeThread();
    const surface = new DiscordTaskControlSurface();

    await surface.update(thread, activeTask);

    expect(thread.send).toHaveBeenCalledTimes(1);
  });

  it('edits the existing task card instead of posting another one', async () => {
    const edit = vi.fn(async () => undefined);
    const existing = {
      author: { id: 'bot-1' },
      edit,
      components: [{ components: [{ customId: 'task-control:inspect:task-1' }] }],
    };
    const thread = fakeThread(existing);
    const surface = new DiscordTaskControlSurface();

    await surface.update(thread, completedTask, result);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(thread.send).not.toHaveBeenCalled();
  });

  it('does not edit a control-like message owned by another bot', async () => {
    const edit = vi.fn(async () => undefined);
    const existing = {
      author: { id: 'other-bot' },
      edit,
      components: [{ components: [{ customId: 'task-control:inspect:task-1' }] }],
    };
    const thread = fakeThread(existing);
    const surface = new DiscordTaskControlSurface();

    await surface.update(thread, activeTask);

    expect(edit).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledTimes(1);
  });
});

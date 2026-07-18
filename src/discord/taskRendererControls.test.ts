import { describe, expect, it } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import type { TaskRecord } from '../types.js';
import { DiscordTaskRenderer } from './taskRenderer.js';

class FakeSentMessage {
  readonly id = 'message-1';
  readonly edits: unknown[] = [];
  rejectNextEmbedEdit = false;

  constructor(readonly payload: unknown) {}

  async edit(payload: unknown) {
    if (this.rejectNextEmbedEdit && hasEmbeds(payload)) {
      this.rejectNextEmbedEdit = false;
      throw new Error('embed edit rejected');
    }
    this.edits.push(payload);
    return this;
  }

  async pin() { return this; }
}

class FakeThread {
  readonly id = 'thread-1';
  readonly sent: FakeSentMessage[] = [];
  rejectNextEmbedSend = false;

  async send(payload: unknown) {
    if (this.rejectNextEmbedSend && hasEmbeds(payload)) {
      this.rejectNextEmbedSend = false;
      throw new Error('embed send rejected');
    }
    const message = new FakeSentMessage(payload);
    this.sent.push(message);
    return message;
  }
}

function hasEmbeds(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && 'embeds' in payload);
}

function thread(fake: FakeThread): AnyThreadChannel {
  return fake as unknown as AnyThreadChannel;
}

function task(status: TaskRecord['status']): TaskRecord {
  return {
    id: 'task-1',
    projectName: 'discord-agent',
    provider: 'codex',
    status,
    channelId: 'agent-1',
    threadId: 'thread-1',
    objective: 'Preserve task controls',
    createdAt: 1,
    updatedAt: 1,
  };
}

function serialized(payload: unknown): string {
  return JSON.stringify(payload);
}

function expectTaskControls(payload: unknown): void {
  const value = serialized(payload);
  expect(value).toContain('task-control:inspect');
  expect(value).toContain('task-control:cancel');
}

describe('DiscordTaskRenderer task-control fallbacks', () => {
  it('preserves task controls when an embed send falls back to plain text', async () => {
    const fake = new FakeThread();
    fake.rejectNextEmbedSend = true;
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardCanEmbed: () => true,
    });

    await renderer.start(thread(fake), { task: task('starting') });

    expect(fake.sent).toHaveLength(1);
    expectTaskControls(fake.sent[0].payload);
  });

  it('preserves task controls when an embed edit falls back to plain text', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardCanEmbed: () => true,
    });
    await renderer.start(thread(fake), { task: task('starting') });
    fake.sent[0].rejectNextEmbedEdit = true;

    await renderer.updateCard?.({ task: task('running') });

    expect(fake.sent[0].edits).toHaveLength(1);
    expectTaskControls(fake.sent[0].edits[0]);
  });
});

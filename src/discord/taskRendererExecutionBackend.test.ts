import type { AnyThreadChannel } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../types.js';
import { DiscordTaskRenderer } from './taskRenderer.js';

class FakeThread {
  readonly id = 'thread-factory-floor';
  readonly sent: unknown[] = [];

  async send(payload: unknown) {
    this.sent.push(payload);
    return {
      id: 'message-1',
      edit: async () => undefined,
      pin: async () => undefined,
    };
  }
}

function task(): TaskRecord {
  return {
    id: 'task-factory-floor',
    projectName: 'discordagent',
    provider: 'codex',
    executionBackend: 'factory_floor',
    status: 'running',
    channelId: 'channel-1',
    threadId: 'thread-factory-floor',
    objective: 'Render authoritative execution identity',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('DiscordTaskRenderer execution authority', () => {
  it('renders a Factory Floor task without relabeling it as local execution', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardCanEmbed: () => false,
    });

    await renderer.start(fake as unknown as AnyThreadChannel, { task: task() });

    expect(JSON.stringify(fake.sent[0])).toContain('Execution backend: factory_floor');
    expect(JSON.stringify(fake.sent[0])).not.toContain('Execution backend: local_provider');
  });
});

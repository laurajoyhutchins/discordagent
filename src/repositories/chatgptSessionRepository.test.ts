import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createChatgptSessionRepository } from './chatgptSessionRepository.js';

const tempDirectories: string[] = [];
const openHandles: DatabaseHandle[] = [];

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-chatgpt-session-'));
  tempDirectories.push(directory);
  const database = openDatabase(join(directory, 'test.sqlite'));
  openHandles.push(database);
  runMigrations(database);
  return createChatgptSessionRepository(database);
}

afterEach(() => {
  while (openHandles.length > 0) openHandles.pop()?.close();
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('ChatGPT session bindings', () => {
  it('binds one active ChatGPT conversation to one Discord thread and retires it explicitly', () => {
    const repository = createRepository();

    const bound = repository.bind({
      discordThreadId: 'thread-1',
      chatgptConversationId: '11111111-2222-3333-4444-555555555555',
      boundBy: 'user-1',
      boundAt: 100,
    });

    expect(bound).toMatchObject({
      discordThreadId: 'thread-1',
      chatgptConversationId: '11111111-2222-3333-4444-555555555555',
      chatgptConversationUrl: 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
      boundBy: 'user-1',
      boundAt: 100,
    });
    expect(repository.findActiveByThreadId('thread-1')).toEqual(bound);

    const retired = repository.retireByThreadId('thread-1', 200);
    expect(retired?.retiredAt).toBe(200);
    expect(repository.findActiveByThreadId('thread-1')).toBeUndefined();
  });

  it('keeps active thread and conversation identity one-to-one', () => {
    const repository = createRepository();

    repository.bind({
      discordThreadId: 'thread-1',
      chatgptConversationId: 'conversation-1',
      boundBy: 'user-1',
      boundAt: 100,
    });

    expect(() => repository.bind({
      discordThreadId: 'thread-1',
      chatgptConversationId: 'conversation-2',
      boundBy: 'user-1',
      boundAt: 101,
    })).toThrow(/thread.*already bound/i);

    expect(() => repository.bind({
      discordThreadId: 'thread-2',
      chatgptConversationId: 'conversation-1',
      boundBy: 'user-1',
      boundAt: 102,
    })).toThrow(/conversation.*already bound/i);
  });

  it('treats rebinding the same active pair as idempotent', () => {
    const repository = createRepository();
    const input = {
      discordThreadId: 'thread-1',
      chatgptConversationId: 'conversation-1',
      boundBy: 'user-1',
      boundAt: 100,
    } as const;

    const first = repository.bind(input);
    const second = repository.bind({ ...input, boundAt: 999 });

    expect(second).toEqual(first);
  });
});

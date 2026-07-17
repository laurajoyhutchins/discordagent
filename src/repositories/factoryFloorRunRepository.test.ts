import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createFactoryFloorRunRepository } from './factoryFloorRunRepository.js';

const databases: DatabaseHandle[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  runMigrations(db);
  return createFactoryFloorRunRepository(db);
}

describe('FactoryFloorRunRepository', () => {
  it('persists Discord bindings and active status', () => {
    const repository = setup();
    const binding = repository.create({
      runId: 'run-1',
      projectName: 'factory-floor',
      repository: 'owner/repo',
      objective: 'Implement bridge',
      requestedBy: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      statusMessageId: 'message-1',
      status: 'accepted',
    });

    expect(binding.runId).toBe('run-1');
    expect(repository.findByThreadId('thread-1')).toMatchObject({ runId: 'run-1' });
    expect(repository.listActive()).toHaveLength(1);
  });

  it('removes terminal runs from recovery polling', () => {
    const repository = setup();
    repository.create({
      runId: 'run-1',
      projectName: 'factory-floor',
      repository: 'owner/repo',
      objective: 'Implement bridge',
      requestedBy: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      statusMessageId: 'message-1',
      status: 'running',
    });

    const terminal = repository.updateStatus('run-1', 'completed');
    expect(terminal.terminalAt).toBeTypeOf('number');
    expect(repository.listActive()).toEqual([]);
  });
});

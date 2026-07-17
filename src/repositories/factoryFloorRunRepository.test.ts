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

function createRun(repository: ReturnType<typeof setup>, status: 'accepted' | 'running' = 'running') {
  return repository.create({
    runId: 'run-1',
    projectName: 'factory-floor',
    repository: 'owner/repo',
    objective: 'Implement bridge',
    requestedBy: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    threadId: 'thread-1',
    statusMessageId: 'message-1',
    status,
  });
}

describe('FactoryFloorRunRepository', () => {
  it('persists Discord bindings and active status', () => {
    const repository = setup();
    const binding = createRun(repository, 'accepted');

    expect(binding.runId).toBe('run-1');
    expect(repository.findByThreadId('thread-1')).toMatchObject({ runId: 'run-1' });
    expect(repository.listActive()).toHaveLength(1);
  });

  it('removes terminal runs from recovery polling', () => {
    const repository = setup();
    createRun(repository);

    const terminal = repository.updateStatus('run-1', 'completed');
    expect(terminal.terminalAt).toBeTypeOf('number');
    expect(repository.listActive()).toEqual([]);
  });

  it('does not reactivate a terminal binding from a stale status response', () => {
    const repository = setup();
    createRun(repository);
    repository.updateStatus('run-1', 'completed');

    expect(repository.updateStatus('run-1', 'running')).toMatchObject({
      status: 'completed',
      terminalAt: expect.any(Number),
    });
    expect(repository.listActive()).toEqual([]);
  });
});

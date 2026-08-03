import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from './projectRepository.js';
import { createTaskRepository } from './taskRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-task-backend-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'state.sqlite'));
  handles.push(db);
  runMigrations(db);
  createProjectRepository(db).create({
    name: 'discordagent',
    workingDirectory: join(directory, 'discordagent'),
    categoryId: 'category-1',
    agentChannelId: 'channel-1',
    defaultProvider: 'claude',
  });
  return createTaskRepository(db);
}

function localTask(executionBackend: 'local_provider' | 'factory_floor') {
  return {
    taskId: `task-${executionBackend}`,
    projectName: 'discordagent',
    provider: 'claude' as const,
    executionBackend,
    channelId: 'channel-1',
    threadId: `thread-${executionBackend}`,
    objective: 'Review the repository',
    worktree: {
      id: `worktree-${executionBackend}`,
      repositoryPath: '/repos/discordagent',
      worktreePath: `/worktrees/${executionBackend}`,
      branchName: `agent/claude/${executionBackend}`,
      baseRef: 'main',
    },
  };
}

describe('TaskRepository execution authority', () => {
  it('persists and reloads the immutable local-provider backend', () => {
    const tasks = setup();

    const created = tasks.createWithWorktree(localTask('local_provider'));

    expect(created.executionBackend).toBe('local_provider');
    expect(tasks.findById(created.id)?.executionBackend).toBe('local_provider');
  });

  it('rejects Factory Floor identity through the local worktree creation path', () => {
    const tasks = setup();

    expect(() => tasks.createWithWorktree(localTask('factory_floor')))
      .toThrow(/local_provider/i);
  });
});

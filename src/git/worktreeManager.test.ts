import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitClient } from './gitClient.js';
import { createWorktreeManager } from './worktreeManager.js';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createRepository(): { root: string; repo: string; worktrees: string } {
  const root = join(tmpdir(), `discordagent worktrees ${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const repo = join(root, 'repository with spaces');
  const worktrees = join(root, 'managed worktrees');
  roots.push(root);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Discord Agent Tests');
  git(repo, 'config', 'user.email', 'tests@example.invalid');
  writeFileSync(join(repo, 'README.md'), 'initial\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'initial');
  return { root, repo, worktrees };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('WorktreeManager', () => {
  it('creates an isolated branch and worktree from the current local branch', async () => {
    const { repo, worktrees } = createRepository();
    const mainCommit = git(repo, 'rev-parse', 'main');
    const manager = createWorktreeManager({ baseDirectory: worktrees, git: createGitClient() });

    const created = await manager.create({
      repositoryPath: repo,
      provider: 'claude',
      taskId: 'task-alpha',
      threadId: '123456789012',
      objective: 'Add worker registry',
    });

    expect(created.branchName).toBe('agent/claude/add-worker-registry-789012');
    expect(created.baseRef).toBe('main');
    expect(created.repositoryPath).toBe(repo);
    expect(existsSync(join(created.worktreePath, 'README.md'))).toBe(true);
    expect(git(created.worktreePath, 'rev-parse', 'HEAD')).toBe(mainCommit);
    expect(git(created.worktreePath, 'branch', '--show-current')).toBe(created.branchName);
  });

  it('serializes concurrent collisions into unique branches and writable paths', async () => {
    const { repo, worktrees } = createRepository();
    const manager = createWorktreeManager({ baseDirectory: worktrees, git: createGitClient() });
    const common = {
      repositoryPath: repo,
      provider: 'codex' as const,
      threadId: '999999123456',
      objective: 'Fix checkout race',
    };

    const [first, second] = await Promise.all([
      manager.create({ ...common, taskId: 'task-one' }),
      manager.create({ ...common, taskId: 'task-two' }),
    ]);

    expect(first.branchName).not.toBe(second.branchName);
    expect(first.worktreePath).not.toBe(second.worktreePath);
    expect(new Set([first.branchName, second.branchName])).toContain('agent/codex/fix-checkout-race-123456');
    expect([first.branchName, second.branchName].some(name => name.includes('task-two'))).toBe(true);
    expect(existsSync(first.worktreePath)).toBe(true);
    expect(existsSync(second.worktreePath)).toBe(true);
  });

  it('uses an explicitly configured local base branch', async () => {
    const { repo, worktrees } = createRepository();
    git(repo, 'checkout', '-b', 'release-base');
    writeFileSync(join(repo, 'release.txt'), 'release\n');
    git(repo, 'add', 'release.txt');
    git(repo, 'commit', '-m', 'release base');
    const releaseCommit = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', 'main');

    const manager = createWorktreeManager({ baseDirectory: worktrees, git: createGitClient() });
    const created = await manager.create({
      repositoryPath: repo,
      provider: 'claude',
      taskId: 'task-release',
      threadId: '444444654321',
      objective: 'Prepare release',
      baseBranch: 'release-base',
    });

    expect(created.baseRef).toBe('release-base');
    expect(git(created.worktreePath, 'rev-parse', 'HEAD')).toBe(releaseCommit);
    expect(existsSync(join(created.worktreePath, 'release.txt'))).toBe(true);
  });

  it('refuses dirty removal and removes a clean worktree without force', async () => {
    const { repo, worktrees } = createRepository();
    const manager = createWorktreeManager({ baseDirectory: worktrees, git: createGitClient() });
    const created = await manager.create({
      repositoryPath: repo,
      provider: 'claude',
      taskId: 'task-dirty',
      threadId: '111111222222',
      objective: 'Test cleanup',
    });

    const dirtyFile = join(created.worktreePath, 'uncommitted.txt');
    writeFileSync(dirtyFile, 'do not discard\n');
    await expect(manager.remove({
      repositoryPath: repo,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      removeBranch: true,
    })).rejects.toThrow(/uncommitted/i);
    expect(existsSync(created.worktreePath)).toBe(true);

    unlinkSync(dirtyFile);
    await manager.remove({
      repositoryPath: repo,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      removeBranch: true,
    });
    expect(existsSync(created.worktreePath)).toBe(false);
    expect(git(repo, 'branch', '--list', created.branchName)).toBe('');
  });

  it('inspects worktree state and rejects repositories with Git operations in progress', async () => {
    const { repo, worktrees } = createRepository();
    const manager = createWorktreeManager({ baseDirectory: worktrees, git: createGitClient() });
    const created = await manager.create({
      repositoryPath: repo,
      provider: 'claude',
      taskId: 'task-inspect',
      threadId: '777777888888',
      objective: 'Inspect task',
    });

    expect(await manager.inspect(created.worktreePath)).toMatchObject({
      exists: true,
      dirty: false,
      branchName: created.branchName,
    });
    writeFileSync(join(created.worktreePath, 'change.txt'), 'dirty\n');
    expect(await manager.inspect(created.worktreePath)).toMatchObject({ exists: true, dirty: true });
    expect(await manager.inspect(join(worktrees, 'missing'))).toEqual({
      path: join(worktrees, 'missing'),
      exists: false,
      dirty: false,
    });

    writeFileSync(join(repo, '.git', 'MERGE_HEAD'), '0000000000000000000000000000000000000000\n');
    await expect(manager.create({
      repositoryPath: repo,
      provider: 'codex',
      taskId: 'task-blocked',
      threadId: '333333444444',
      objective: 'Should not start',
    })).rejects.toThrow(/merge.*in progress/i);
  });
});

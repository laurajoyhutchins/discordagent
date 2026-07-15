import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentProviderId } from '../agents/contracts.js';
import type { GitClient } from './gitClient.js';

export interface CreateWorktreeInput {
  repositoryPath: string;
  provider: AgentProviderId;
  taskId: string;
  threadId: string;
  objective: string;
  baseBranch?: string;
}

export interface CreatedWorktree {
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
}

export interface WorktreeInspection {
  path: string;
  exists: boolean;
  dirty: boolean;
  branchName?: string;
}

export interface RemoveWorktreeInput {
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  removeBranch?: boolean;
}

export interface WorktreeManager {
  create(input: CreateWorktreeInput): Promise<CreatedWorktree>;
  inspect(path: string): Promise<WorktreeInspection>;
  remove(input: RemoveWorktreeInput): Promise<void>;
  pruneAdministrativeMetadata(repositoryPath: string): Promise<void>;
}

interface WorktreeManagerOptions {
  baseDirectory: string;
  git: GitClient;
}

const repositoryQueues = new Map<string, Promise<void>>();

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return normalized || fallback;
}

async function withRepositoryLock<T>(repositoryPath: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(repositoryPath);
  const previous = repositoryQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolveLock => { release = resolveLock; });
  const tail = previous.then(() => current);
  repositoryQueues.set(key, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (repositoryQueues.get(key) === tail) repositoryQueues.delete(key);
  }
}

async function pathForGitState(git: GitClient, repositoryPath: string, name: string): Promise<string> {
  const { stdout } = await git.run(repositoryPath, ['rev-parse', '--git-path', name]);
  return resolve(repositoryPath, stdout);
}

async function assertNoOperationInProgress(git: GitClient, repositoryPath: string): Promise<void> {
  const operations = [
    { label: 'merge', paths: ['MERGE_HEAD'] },
    { label: 'rebase', paths: ['rebase-merge', 'rebase-apply'] },
    { label: 'cherry-pick', paths: ['CHERRY_PICK_HEAD'] },
    { label: 'bisect', paths: ['BISECT_LOG'] },
  ];

  for (const operation of operations) {
    for (const gitPath of operation.paths) {
      const path = await pathForGitState(git, repositoryPath, gitPath);
      if (existsSync(path)) {
        throw new Error(`Cannot create a task worktree while a ${operation.label} is in progress`);
      }
    }
  }
}

async function resolveBaseRef(
  git: GitClient,
  repositoryPath: string,
  configured?: string,
): Promise<string> {
  if (configured) {
    await git.run(repositoryPath, ['rev-parse', '--verify', `${configured}^{commit}`]);
    return configured;
  }

  try {
    const { stdout: remoteDefault } = await git.run(repositoryPath, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    if (remoteDefault) return remoteDefault;
  } catch {
    // Local-only repositories are supported; fall back to the checked-out branch.
  }

  const { stdout: currentBranch } = await git.run(
    repositoryPath,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
  );
  if (!currentBranch) {
    throw new Error('Repository HEAD is detached; configure a base branch explicitly');
  }
  return currentBranch;
}

async function branchExists(git: GitClient, repositoryPath: string, branchName: string): Promise<boolean> {
  const { stdout } = await git.run(repositoryPath, ['branch', '--list', branchName]);
  return stdout.length > 0;
}

function worktreeDirectoryName(branchName: string): string {
  return branchName.replaceAll('/', '--');
}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
  const { git } = options;
  const baseDirectory = resolve(options.baseDirectory);

  return {
    async create(input: CreateWorktreeInput): Promise<CreatedWorktree> {
      return withRepositoryLock(input.repositoryPath, async () => {
        const repositoryPath = resolve(input.repositoryPath);
        await git.run(repositoryPath, ['rev-parse', '--show-toplevel']);
        await assertNoOperationInProgress(git, repositoryPath);

        const baseRef = await resolveBaseRef(git, repositoryPath, input.baseBranch);
        const objectiveSlug = slug(input.objective, 'task');
        const threadSuffix = input.threadId.slice(-6) || 'thread';
        const primaryBranch = `agent/${input.provider}/${objectiveSlug}-${threadSuffix}`;
        let branchName = primaryBranch;

        if (await branchExists(git, repositoryPath, branchName)) {
          const taskSuffix = slug(input.taskId, 'task');
          branchName = `${primaryBranch}-${taskSuffix}`;
          let collision = 2;
          while (await branchExists(git, repositoryPath, branchName)) {
            branchName = `${primaryBranch}-${taskSuffix}-${collision}`;
            collision += 1;
          }
        }

        mkdirSync(baseDirectory, { recursive: true });
        let worktreePath = join(baseDirectory, worktreeDirectoryName(branchName));
        let pathCollision = 2;
        while (existsSync(worktreePath)) {
          worktreePath = join(baseDirectory, `${worktreeDirectoryName(branchName)}-${pathCollision}`);
          pathCollision += 1;
        }

        await git.run(repositoryPath, ['worktree', 'add', '-b', branchName, worktreePath, baseRef]);
        return { repositoryPath, worktreePath, branchName, baseRef };
      });
    },

    async inspect(path: string): Promise<WorktreeInspection> {
      const resolvedPath = resolve(path);
      if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
        return { path: resolvedPath, exists: false, dirty: false };
      }

      const [{ stdout: status }, { stdout: branchName }] = await Promise.all([
        git.run(resolvedPath, ['status', '--porcelain']),
        git.run(resolvedPath, ['branch', '--show-current']),
      ]);
      return {
        path: resolvedPath,
        exists: true,
        dirty: status.length > 0,
        ...(branchName ? { branchName } : {}),
      };
    },

    async remove(input: RemoveWorktreeInput): Promise<void> {
      const inspection = await this.inspect(input.worktreePath);
      if (!inspection.exists) return;
      if (inspection.dirty) {
        throw new Error(`Refusing to remove worktree with uncommitted changes: ${input.worktreePath}`);
      }

      await git.run(resolve(input.repositoryPath), ['worktree', 'remove', resolve(input.worktreePath)]);
      if (input.removeBranch) {
        await git.run(resolve(input.repositoryPath), ['branch', '-d', input.branchName]);
      }
    },

    async pruneAdministrativeMetadata(repositoryPath: string): Promise<void> {
      await git.run(resolve(repositoryPath), ['worktree', 'prune']);
    },
  };
}

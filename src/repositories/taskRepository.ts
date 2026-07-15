import { randomUUID } from 'node:crypto';
import type {
  AgentProviderId,
  ProviderSession,
  TaskResult,
  TaskStatus,
} from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';
import type { TaskRecord, WorktreeRecord } from '../types.js';

export interface CreateTaskWorktreeInput {
  id: string;
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
}

export interface CreateTaskTransaction {
  taskId: string;
  projectName: string;
  provider: AgentProviderId;
  channelId: string;
  threadId: string;
  objective: string;
  worktree: CreateTaskWorktreeInput;
  createdAt?: number;
}

export interface TaskRepository {
  createWithWorktree(input: CreateTaskTransaction): TaskRecord;
  attachProviderSession(taskId: string, session: ProviderSession): void;
  transition(taskId: string, expected: readonly TaskStatus[], next: TaskStatus): TaskRecord;
  findById(taskId: string): TaskRecord | undefined;
  findByThreadId(threadId: string): TaskRecord | undefined;
  getWorktree(taskId: string): WorktreeRecord | undefined;
  markWorktreeRemoved(taskId: string, removedAt?: number): void;
  reopenForContinuation(taskId: string): TaskRecord;
  listRecoverable(): TaskRecord[];
  listActive(): TaskRecord[];
  saveResult(taskId: string, result: TaskResult): void;
  getResult(taskId: string): TaskResult | undefined;
}



interface WorktreeRow {
  id: string;
  task_id: string;
  repository_path: string;
  worktree_path: string;
  branch_name: string;
  base_ref: string;
  created_at: number;
  removed_at: number | null;
}

interface TaskRow {
  id: string;
  project_name: string;
  provider: AgentProviderId;
  status: TaskStatus;
  channel_id: string;
  thread_id: string;
  objective: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  provider_session_id: string | null;
}

const TASK_SELECT = `
  SELECT
    t.id,
    p.name AS project_name,
    t.provider,
    t.status,
    t.channel_id,
    t.thread_id,
    t.objective,
    t.created_at,
    t.updated_at,
    t.started_at,
    t.completed_at,
    ps.session_id AS provider_session_id
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN provider_sessions ps ON ps.task_id = t.id
`;

const TERMINAL_STATUSES = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

const LEGAL_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  created: ['starting', 'cancelled'],
  starting: ['running', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting_for_user', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting_for_user: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: ['starting', 'cancelled'],
};

function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectName: row.project_name,
    provider: row.provider,
    status: row.status,
    channelId: row.channel_id,
    threadId: row.thread_id,
    objective: row.objective,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.provider_session_id === null ? {} : { providerSessionId: row.provider_session_id }),
  };
}



function toWorktreeRecord(row: WorktreeRow): WorktreeRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseRef: row.base_ref,
    createdAt: row.created_at,
    ...(row.removed_at === null ? {} : { removedAt: row.removed_at }),
  };
}

export function createTaskRepository(db: DatabaseHandle): TaskRepository {
  const selectById = db.raw.prepare(`${TASK_SELECT} WHERE t.id = ?`);
  const selectByThread = db.raw.prepare(`${TASK_SELECT} WHERE t.thread_id = ?`);

  function requireTask(taskId: string): TaskRecord {
    const row = selectById.get(taskId) as TaskRow | undefined;
    if (!row) throw new Error(`Task "${taskId}" not found`);
    return toTaskRecord(row);
  }

  return {
    createWithWorktree(input: CreateTaskTransaction): TaskRecord {
      const create = db.raw.transaction(() => {
        const project = db.raw.prepare(`
          SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
        `).get(input.projectName) as { id: string } | undefined;
        if (!project) throw new Error(`Project "${input.projectName}" not found`);

        const now = input.createdAt ?? Date.now();
        db.raw.prepare(`
          INSERT INTO tasks (
            id, project_id, provider, status, channel_id, thread_id,
            objective, created_at, updated_at
          ) VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?)
        `).run(
          input.taskId,
          project.id,
          input.provider,
          input.channelId,
          input.threadId,
          input.objective,
          now,
          now,
        );

        db.raw.prepare(`
          INSERT INTO worktrees (
            id, task_id, repository_path, worktree_path,
            branch_name, base_ref, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.worktree.id,
          input.taskId,
          input.worktree.repositoryPath,
          input.worktree.worktreePath,
          input.worktree.branchName,
          input.worktree.baseRef,
          now,
        );
      });

      create();
      return requireTask(input.taskId);
    },

    attachProviderSession(taskId: string, session: ProviderSession): void {
      const task = requireTask(taskId);
      if (task.provider !== session.provider) {
        throw new Error(
          `Provider session must match task provider: expected ${task.provider}, received ${session.provider}`,
        );
      }
      if (task.providerSessionId) {
        throw new Error(`Task "${taskId}" already has a provider session`);
      }

      db.raw.prepare(`
        INSERT INTO provider_sessions (
          id, task_id, provider, session_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        taskId,
        session.provider,
        session.sessionId,
        session.createdAt,
        session.createdAt,
      );
    },

    transition(taskId: string, expected: readonly TaskStatus[], next: TaskStatus): TaskRecord {
      if (expected.length === 0) {
        throw new Error('Task transition requires at least one expected state');
      }

      const current = requireTask(taskId);
      if (!expected.includes(current.status)) {
        throw new Error(
          `Stale task transition for "${taskId}": expected ${expected.join(' or ')}, found ${current.status}`,
        );
      }
      if (!LEGAL_TRANSITIONS[current.status].includes(next)) {
        throw new Error(`Illegal task transition: ${current.status} -> ${next}`);
      }

      const now = Date.now();
      const assignments = ['status = ?', 'updated_at = ?'];
      const values: unknown[] = [next, now];
      if (next === 'running') {
        assignments.push('started_at = COALESCE(started_at, ?)');
        values.push(now);
      }
      if (TERMINAL_STATUSES.has(next)) {
        assignments.push('completed_at = ?');
        values.push(now);
      }

      const placeholders = expected.map(() => '?').join(', ');
      const result = db.raw.prepare(`
        UPDATE tasks
        SET ${assignments.join(', ')}
        WHERE id = ? AND status IN (${placeholders})
      `).run(...values, taskId, ...expected);

      if (result.changes !== 1) {
        throw new Error(`Stale task transition for "${taskId}"`);
      }
      return requireTask(taskId);
    },

    findById(taskId: string): TaskRecord | undefined {
      const row = selectById.get(taskId) as TaskRow | undefined;
      return row ? toTaskRecord(row) : undefined;
    },

    findByThreadId(threadId: string): TaskRecord | undefined {
      const row = selectByThread.get(threadId) as TaskRow | undefined;
      return row ? toTaskRecord(row) : undefined;
    },

    getWorktree(taskId: string): WorktreeRecord | undefined {
      const row = db.raw.prepare(`
        SELECT id, task_id, repository_path, worktree_path,
               branch_name, base_ref, created_at, removed_at
        FROM worktrees
        WHERE task_id = ?
      `).get(taskId) as WorktreeRow | undefined;
      return row ? toWorktreeRecord(row) : undefined;
    },

    markWorktreeRemoved(taskId: string, removedAt = Date.now()): void {
      const result = db.raw.prepare(`
        UPDATE worktrees
        SET removed_at = ?
        WHERE task_id = ? AND removed_at IS NULL
      `).run(removedAt, taskId);
      if (result.changes !== 1) {
        throw new Error(`Active worktree for task "${taskId}" not found`);
      }
    },

    reopenForContinuation(taskId: string): TaskRecord {
      const reopen = db.raw.transaction(() => {
        const task = requireTask(taskId);
        if (!TERMINAL_STATUSES.has(task.status)) {
          throw new Error(`Task "${taskId}" must be terminal before continuation`);
        }
        if (!task.providerSessionId) {
          throw new Error(`Task "${taskId}" has no provider session to continue`);
        }
        const worktree = db.raw.prepare(`
          SELECT removed_at FROM worktrees WHERE task_id = ?
        `).get(taskId) as { removed_at: number | null } | undefined;
        if (!worktree || worktree.removed_at !== null) {
          throw new Error(`Task "${taskId}" has no active worktree to continue`);
        }

        db.raw.prepare('DELETE FROM task_results WHERE task_id = ?').run(taskId);
        db.raw.prepare(`
          UPDATE tasks
          SET status = 'starting', completed_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(Date.now(), taskId);
      });
      reopen();
      return requireTask(taskId);
    },

    listActive(): TaskRecord[] {
      const rows = db.raw.prepare(`${TASK_SELECT}
        WHERE t.status IN ('created', 'starting', 'running', 'waiting_for_user')
        ORDER BY t.created_at, t.id
      `).all() as TaskRow[];
      return rows.map(toTaskRecord);
    },

    listRecoverable(): TaskRecord[] {
      const rows = db.raw.prepare(`${TASK_SELECT}
        WHERE t.status IN ('starting', 'running', 'waiting_for_user')
        ORDER BY t.created_at, t.id
      `).all() as TaskRow[];
      return rows.map(toTaskRecord);
    },

    getResult(taskId: string): TaskResult | undefined {
      const task = requireTask(taskId);
      const row = db.raw.prepare(`
        SELECT outcome, summary, verification_json, unresolved_json, usage_json, completed_at
        FROM task_results WHERE task_id = ?
      `).get(taskId) as {
        outcome: TaskResult['outcome']; summary: string; verification_json: string;
        unresolved_json: string; usage_json: string | null; completed_at: number;
      } | undefined;
      if (!row) return undefined;
      return {
        provider: task.provider,
        outcome: row.outcome,
        exitType: row.outcome,
        startedAt: task.startedAt ?? task.createdAt,
        completedAt: row.completed_at,
        ...(task.providerSessionId ? { sessionId: task.providerSessionId } : {}),
        summary: row.summary,
        verification: JSON.parse(row.verification_json) as string[],
        unresolved: JSON.parse(row.unresolved_json) as string[],
        ...(row.usage_json ? { usage: JSON.parse(row.usage_json) } : {}),
      };
    },

    saveResult(taskId: string, result: TaskResult): void {
      const task = requireTask(taskId);
      if (!TERMINAL_STATUSES.has(task.status)) {
        throw new Error(`Task "${taskId}" must be terminal before saving a result`);
      }
      if (task.provider !== result.provider) {
        throw new Error(
          `Result provider must match task provider: expected ${task.provider}, received ${result.provider}`,
        );
      }
      if (task.status !== result.outcome) {
        throw new Error(`Result outcome ${result.outcome} does not match task status ${task.status}`);
      }
      const existing = db.raw.prepare('SELECT 1 FROM task_results WHERE task_id = ?').get(taskId);
      if (existing) throw new Error(`Task "${taskId}" already has a result`);

      const summary = result.summary ?? result.error?.message ?? result.exitType;
      db.raw.prepare(`
        INSERT INTO task_results (
          task_id, outcome, summary, verification_json,
          unresolved_json, usage_json, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        result.outcome,
        summary,
        JSON.stringify(result.verification ?? []),
        JSON.stringify(result.unresolved ?? []),
        result.usage ? JSON.stringify(result.usage) : null,
        result.completedAt,
      );
    },
  };
}

export type { WorktreeRecord };

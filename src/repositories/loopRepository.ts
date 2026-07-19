import type { DatabaseHandle } from '../db/database.js';
import { redactSensitiveText } from '../utils/redaction.js';

export type ScheduledLoopStatus = 'active' | 'running' | 'stopped' | 'terminal';

export interface ScheduledLoopRecord {
  readonly id: string;
  readonly projectName: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly iteration: number;
  readonly nextRunAt?: number;
  readonly status: ScheduledLoopStatus;
  readonly startedBy: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly stoppedAt?: number;
  readonly stopReason?: string;
}

export interface CreateScheduledLoopInput {
  readonly id: string;
  readonly projectName: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly startedBy: string;
  readonly startedAt?: number;
}

export interface LoopRepository {
  create(input: CreateScheduledLoopInput): ScheduledLoopRecord;
  findById(id: string): ScheduledLoopRecord | undefined;
  findActiveByChannelId(channelId: string): ScheduledLoopRecord | undefined;
  findActiveByThreadId(threadId: string): ScheduledLoopRecord | undefined;
  listResumable(): ScheduledLoopRecord[];
  acquireIteration(id: string, updatedAt?: number): ScheduledLoopRecord | undefined;
  scheduleNext(id: string, nextRunAt: number, updatedAt?: number): ScheduledLoopRecord | undefined;
  deferInterrupted(id: string, nextRunAt: number, updatedAt?: number): ScheduledLoopRecord | undefined;
  stopByChannel(channelId: string, reason: string, stoppedAt?: number): ScheduledLoopRecord | undefined;
  terminalizeById(id: string, reason: string, stoppedAt?: number): ScheduledLoopRecord | undefined;
  terminalizeByThread(threadId: string, reason: string, stoppedAt?: number): ScheduledLoopRecord | undefined;
  terminalizeByChannel(channelId: string, reason: string, stoppedAt?: number): ScheduledLoopRecord | undefined;
  terminalizeByProject(projectName: string, reason: string, stoppedAt?: number): ScheduledLoopRecord[];
}

interface LoopRow {
  id: string;
  project_name: string;
  channel_id: string;
  thread_id: string;
  prompt: string;
  interval_ms: number;
  iteration: number;
  next_run_at: number | null;
  status: ScheduledLoopStatus;
  started_by: string;
  started_at: number;
  updated_at: number;
  stopped_at: number | null;
  stop_reason: string | null;
}

const LOOP_SELECT = `
  SELECT
    l.id,
    p.name AS project_name,
    l.channel_id,
    l.thread_id,
    l.prompt,
    l.interval_ms,
    l.iteration,
    l.next_run_at,
    l.status,
    l.started_by,
    l.started_at,
    l.updated_at,
    l.stopped_at,
    l.stop_reason
  FROM scheduled_loops l
  JOIN projects p ON p.id = l.project_id
`;

function toRecord(row: LoopRow): ScheduledLoopRecord {
  return {
    id: row.id,
    projectName: row.project_name,
    channelId: row.channel_id,
    threadId: row.thread_id,
    prompt: row.prompt,
    intervalMs: row.interval_ms,
    iteration: row.iteration,
    status: row.status,
    startedBy: row.started_by,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...(row.next_run_at === null ? {} : { nextRunAt: row.next_run_at }),
    ...(row.stopped_at === null ? {} : { stoppedAt: row.stopped_at }),
    ...(row.stop_reason === null ? {} : { stopReason: row.stop_reason }),
  };
}

export function createLoopRepository(db: DatabaseHandle): LoopRepository {
  const selectById = db.raw.prepare(`${LOOP_SELECT} WHERE l.id = ?`);
  const selectActiveByChannel = db.raw.prepare(`${LOOP_SELECT}
    WHERE l.channel_id = ? AND l.status IN ('active', 'running')
    ORDER BY l.started_at DESC, l.id DESC
    LIMIT 1
  `);
  const selectActiveByThread = db.raw.prepare(`${LOOP_SELECT}
    WHERE l.thread_id = ? AND l.status IN ('active', 'running')
    LIMIT 1
  `);

  function findById(id: string): ScheduledLoopRecord | undefined {
    const row = selectById.get(id) as LoopRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  function updateOne(
    sql: string,
    values: readonly unknown[],
    id: string,
  ): ScheduledLoopRecord | undefined {
    const result = db.raw.prepare(sql).run(...values);
    return result.changes === 1 ? findById(id) : undefined;
  }

  function terminalizeWhere(
    where: string,
    key: string,
    reason: string,
    stoppedAt: number,
  ): ScheduledLoopRecord | undefined {
    const row = db.raw.prepare(`${LOOP_SELECT}
      WHERE ${where} AND l.status IN ('active', 'running')
      ORDER BY l.started_at DESC, l.id DESC
      LIMIT 1
    `).get(key) as LoopRow | undefined;
    if (!row) return undefined;
    return updateOne(`
      UPDATE scheduled_loops
      SET status = 'terminal', next_run_at = NULL, stopped_at = ?, stop_reason = ?, updated_at = ?
      WHERE id = ? AND status IN ('active', 'running')
    `, [stoppedAt, redactSensitiveText(reason), stoppedAt, row.id], row.id);
  }

  return {
    create(input): ScheduledLoopRecord {
      if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
        throw new Error('Scheduled loop interval must be a positive integer');
      }
      if (selectActiveByChannel.get(input.channelId)) {
        throw new Error(`An active scheduled loop already exists for channel "${input.channelId}"`);
      }
      const project = db.raw.prepare(`
        SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
      `).get(input.projectName) as { id: string } | undefined;
      if (!project) throw new Error(`Project "${input.projectName}" not found`);
      const now = input.startedAt ?? Date.now();
      try {
        db.raw.prepare(`
          INSERT INTO scheduled_loops (
            id, project_id, channel_id, thread_id, prompt, interval_ms,
            iteration, next_run_at, status, started_by, started_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'active', ?, ?, ?)
        `).run(
          input.id,
          project.id,
          input.channelId,
          input.threadId,
          redactSensitiveText(input.prompt),
          input.intervalMs,
          input.startedBy,
          now,
          now,
        );
      } catch (error) {
        if (error instanceof Error && /scheduled_loops_active_channel_idx|UNIQUE constraint failed: scheduled_loops\.channel_id/i.test(error.message)) {
          throw new Error(`An active scheduled loop already exists for channel "${input.channelId}"`);
        }
        throw error;
      }
      return findById(input.id)!;
    },

    findById,

    findActiveByChannelId(channelId): ScheduledLoopRecord | undefined {
      const row = selectActiveByChannel.get(channelId) as LoopRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    findActiveByThreadId(threadId): ScheduledLoopRecord | undefined {
      const row = selectActiveByThread.get(threadId) as LoopRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    listResumable(): ScheduledLoopRecord[] {
      const rows = db.raw.prepare(`${LOOP_SELECT}
        WHERE l.status IN ('active', 'running')
        ORDER BY COALESCE(l.next_run_at, l.started_at), l.started_at, l.id
      `).all() as LoopRow[];
      return rows.map(toRecord);
    },

    acquireIteration(id, updatedAt = Date.now()): ScheduledLoopRecord | undefined {
      return updateOne(`
        UPDATE scheduled_loops
        SET status = 'running', iteration = iteration + 1, next_run_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'active'
      `, [updatedAt, id], id);
    },

    scheduleNext(id, nextRunAt, updatedAt = Date.now()): ScheduledLoopRecord | undefined {
      return updateOne(`
        UPDATE scheduled_loops
        SET status = 'active', next_run_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `, [nextRunAt, updatedAt, id], id);
    },

    deferInterrupted(id, nextRunAt, updatedAt = Date.now()): ScheduledLoopRecord | undefined {
      return updateOne(`
        UPDATE scheduled_loops
        SET status = 'active', next_run_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `, [nextRunAt, updatedAt, id], id);
    },

    stopByChannel(channelId, reason, stoppedAt = Date.now()): ScheduledLoopRecord | undefined {
      const row = selectActiveByChannel.get(channelId) as LoopRow | undefined;
      if (!row) return undefined;
      return updateOne(`
        UPDATE scheduled_loops
        SET status = 'stopped', next_run_at = NULL, stopped_at = ?, stop_reason = ?, updated_at = ?
        WHERE id = ? AND status IN ('active', 'running')
      `, [stoppedAt, redactSensitiveText(reason), stoppedAt, row.id], row.id);
    },

    terminalizeById(id, reason, stoppedAt = Date.now()): ScheduledLoopRecord | undefined {
      return updateOne(`
        UPDATE scheduled_loops
        SET status = 'terminal', next_run_at = NULL, stopped_at = ?, stop_reason = ?, updated_at = ?
        WHERE id = ? AND status IN ('active', 'running')
      `, [stoppedAt, redactSensitiveText(reason), stoppedAt, id], id);
    },

    terminalizeByThread(threadId, reason, stoppedAt = Date.now()): ScheduledLoopRecord | undefined {
      return terminalizeWhere('l.thread_id = ?', threadId, reason, stoppedAt);
    },

    terminalizeByChannel(channelId, reason, stoppedAt = Date.now()): ScheduledLoopRecord | undefined {
      return terminalizeWhere('l.channel_id = ?', channelId, reason, stoppedAt);
    },

    terminalizeByProject(projectName, reason, stoppedAt = Date.now()): ScheduledLoopRecord[] {
      return db.raw.transaction(() => {
        const rows = db.raw.prepare(`${LOOP_SELECT}
          WHERE p.name = ? COLLATE NOCASE AND l.status IN ('active', 'running')
          ORDER BY l.started_at, l.id
        `).all(projectName) as LoopRow[];
        const result: ScheduledLoopRecord[] = [];
        for (const row of rows) {
          const terminal = updateOne(`
            UPDATE scheduled_loops
            SET status = 'terminal', next_run_at = NULL, stopped_at = ?, stop_reason = ?, updated_at = ?
            WHERE id = ? AND status IN ('active', 'running')
          `, [stoppedAt, redactSensitiveText(reason), stoppedAt, row.id], row.id);
          if (terminal) result.push(terminal);
        }
        return result;
      })();
    },
  };
}

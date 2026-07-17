import type { DatabaseHandle } from '../db/database.js';
import type { FactoryFloorRunState } from '../factoryFloor/client.js';

export interface FactoryFloorRunBinding {
  runId: string;
  projectName: string;
  repository: string;
  objective: string;
  requestedBy: string;
  guildId: string;
  channelId: string;
  threadId: string;
  statusMessageId: string;
  status: FactoryFloorRunState;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  terminalAt?: number;
}

export interface FactoryFloorRunRepository {
  create(input: Omit<FactoryFloorRunBinding, 'createdAt' | 'updatedAt' | 'terminalAt' | 'lastError'>): FactoryFloorRunBinding;
  findByRunId(runId: string): FactoryFloorRunBinding | undefined;
  findByThreadId(threadId: string): FactoryFloorRunBinding | undefined;
  listActive(): FactoryFloorRunBinding[];
  updateStatus(runId: string, status: FactoryFloorRunState, lastError?: string): FactoryFloorRunBinding;
  recordError(runId: string, message: string): FactoryFloorRunBinding;
}

interface BindingRow {
  run_id: string;
  project_name: string;
  repository: string;
  objective: string;
  requested_by: string;
  guild_id: string;
  channel_id: string;
  thread_id: string;
  status_message_id: string;
  status: FactoryFloorRunState;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  terminal_at: number | null;
}

const TERMINAL = new Set<FactoryFloorRunState>([
  'completed',
  'failed',
  'cancelled',
  'rejected',
]);

function map(row: BindingRow): FactoryFloorRunBinding {
  return {
    runId: row.run_id,
    projectName: row.project_name,
    repository: row.repository,
    objective: row.objective,
    requestedBy: row.requested_by,
    guildId: row.guild_id,
    channelId: row.channel_id,
    threadId: row.thread_id,
    statusMessageId: row.status_message_id,
    status: row.status,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.terminal_at ? { terminalAt: row.terminal_at } : {}),
  };
}

export function createFactoryFloorRunRepository(
  db: DatabaseHandle,
): FactoryFloorRunRepository {
  const byRun = db.raw.prepare('SELECT * FROM factory_floor_runs WHERE run_id = ?');
  const byThread = db.raw.prepare('SELECT * FROM factory_floor_runs WHERE thread_id = ?');

  function requireRun(runId: string): BindingRow {
    const row = byRun.get(runId) as BindingRow | undefined;
    if (!row) throw new Error(`Factory Floor run ${runId} is not bound to Discord`);
    return row;
  }

  return {
    create(input) {
      const now = Date.now();
      db.raw.prepare(`
        INSERT INTO factory_floor_runs (
          run_id, project_name, repository, objective, requested_by,
          guild_id, channel_id, thread_id, status_message_id,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.runId,
        input.projectName,
        input.repository,
        input.objective,
        input.requestedBy,
        input.guildId,
        input.channelId,
        input.threadId,
        input.statusMessageId,
        input.status,
        now,
        now,
      );
      return map(requireRun(input.runId));
    },

    findByRunId(runId) {
      const row = byRun.get(runId) as BindingRow | undefined;
      return row ? map(row) : undefined;
    },

    findByThreadId(threadId) {
      const row = byThread.get(threadId) as BindingRow | undefined;
      return row ? map(row) : undefined;
    },

    listActive() {
      return (db.raw.prepare(`
        SELECT * FROM factory_floor_runs
        WHERE terminal_at IS NULL
        ORDER BY created_at, run_id
      `).all() as BindingRow[]).map(map);
    },

    updateStatus(runId, status, lastError) {
      const now = Date.now();
      db.raw.prepare(`
        UPDATE factory_floor_runs
        SET status = ?, last_error = ?, updated_at = ?, terminal_at = ?
        WHERE run_id = ?
      `).run(
        status,
        lastError ?? null,
        now,
        TERMINAL.has(status) ? now : null,
        runId,
      );
      return map(requireRun(runId));
    },

    recordError(runId, message) {
      db.raw.prepare(`
        UPDATE factory_floor_runs
        SET last_error = ?, updated_at = ?
        WHERE run_id = ?
      `).run(message, Date.now(), runId);
      return map(requireRun(runId));
    },
  };
}

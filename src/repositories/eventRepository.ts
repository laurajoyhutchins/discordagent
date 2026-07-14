import { isAgentEvent, type AgentEvent } from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';

export interface StoredTaskEvent {
  id: number;
  taskId: string;
  dedupeKey?: string;
  event: AgentEvent;
  createdAt: number;
}

export interface EventRepository {
  append(taskId: string, event: AgentEvent, dedupeKey?: string): void;
  list(taskId: string): StoredTaskEvent[];
}

interface EventRow {
  id: number;
  task_id: string;
  dedupe_key: string | null;
  payload_json: string;
  created_at: number;
}

export function createEventRepository(db: DatabaseHandle): EventRepository {
  return {
    append(taskId: string, event: AgentEvent, dedupeKey?: string): void {
      if (!isAgentEvent(event)) {
        throw new Error('Cannot persist an invalid agent event');
      }

      const now = Date.now();
      if (dedupeKey) {
        db.raw.prepare(`
          INSERT INTO task_events (task_id, dedupe_key, type, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(task_id, dedupe_key) DO NOTHING
        `).run(taskId, dedupeKey, event.type, JSON.stringify(event), now);
        return;
      }

      db.raw.prepare(`
        INSERT INTO task_events (task_id, dedupe_key, type, payload_json, created_at)
        VALUES (?, NULL, ?, ?, ?)
      `).run(taskId, event.type, JSON.stringify(event), now);
    },

    list(taskId: string): StoredTaskEvent[] {
      const rows = db.raw.prepare(`
        SELECT id, task_id, dedupe_key, payload_json, created_at
        FROM task_events
        WHERE task_id = ?
        ORDER BY id
      `).all(taskId) as EventRow[];

      return rows.map(row => {
        const event = JSON.parse(row.payload_json) as unknown;
        if (!isAgentEvent(event)) {
          throw new Error(`Stored event ${row.id} is invalid`);
        }
        return {
          id: row.id,
          taskId: row.task_id,
          event,
          createdAt: row.created_at,
          ...(row.dedupe_key === null ? {} : { dedupeKey: row.dedupe_key }),
        };
      });
    },
  };
}

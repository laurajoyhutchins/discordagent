import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '../db/database.js';

export interface MemoryRecord {
  id: string; namespace: string; key: string; value: unknown; sourceType: string; sourceId?: string;
  confidence: number; readOnly: boolean; createdAt: number; updatedAt: number;
}
export interface MemoryRepository {
  list(namespace: string): MemoryRecord[];
  get(namespace: string, key: string): MemoryRecord | undefined;
  put(input: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MemoryRecord;
  archive(namespace: string, key: string): void;
}
export function createMemoryRepository(db: DatabaseHandle): MemoryRepository {
  function map(row: any): MemoryRecord { return { id: row.id, namespace: row.namespace, key: row.memory_key, value: JSON.parse(row.value_json), sourceType: row.source_type, ...(row.source_id ? { sourceId: row.source_id } : {}), confidence: row.confidence, readOnly: Boolean(row.read_only), createdAt: row.created_at, updatedAt: row.updated_at }; }
  const select = db.raw.prepare(`SELECT * FROM memory_records WHERE namespace = ? AND memory_key = ? AND archived_at IS NULL`);
  return {
    list(namespace) { return (db.raw.prepare(`SELECT * FROM memory_records WHERE namespace = ? AND archived_at IS NULL ORDER BY memory_key`).all(namespace) as any[]).map(map); },
    get(namespace, key) { const value = select.get(namespace, key); return value ? map(value) : undefined; },
    put(input) {
      const existing = select.get(input.namespace, input.key) as any | undefined;
      if (existing?.read_only) throw new Error(`Memory ${input.namespace}/${input.key} is read-only`);
      const now = Date.now(); const next = JSON.stringify(input.value);
      const save = db.raw.transaction(() => {
        if (existing) {
          db.raw.prepare(`INSERT INTO memory_revisions (memory_id, previous_value_json, next_value_json, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(existing.id, existing.value_json, next, input.sourceType, input.sourceId ?? null, now);
          db.raw.prepare(`UPDATE memory_records SET value_json=?, source_type=?, source_id=?, confidence=?, read_only=?, updated_at=? WHERE id=?`)
            .run(next, input.sourceType, input.sourceId ?? null, input.confidence, input.readOnly ? 1 : 0, now, existing.id);
          return existing.id as string;
        }
        const id = input.id ?? randomUUID();
        db.raw.prepare(`INSERT INTO memory_records (id, namespace, memory_key, value_json, source_type, source_id, confidence, read_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, input.namespace, input.key, next, input.sourceType, input.sourceId ?? null, input.confidence, input.readOnly ? 1 : 0, now, now);
        db.raw.prepare(`INSERT INTO memory_revisions (memory_id, previous_value_json, next_value_json, source_type, source_id, created_at) VALUES (?, NULL, ?, ?, ?, ?)`)
          .run(id, next, input.sourceType, input.sourceId ?? null, now);
        return id;
      });
      const id = save();
      return map(db.raw.prepare('SELECT * FROM memory_records WHERE id=?').get(id));
    },
    archive(namespace, key) { db.raw.prepare(`UPDATE memory_records SET archived_at=?, updated_at=? WHERE namespace=? AND memory_key=? AND read_only=0`).run(Date.now(), Date.now(), namespace, key); },
  };
}

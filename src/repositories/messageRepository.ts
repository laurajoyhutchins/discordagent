import type { DatabaseHandle } from '../db/database.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'agent';
export interface JournalMessage {
  id: string; channelId: string; threadId?: string; taskId?: string;
  authorId: string; role: MessageRole; content: string; createdAt: number; editedAt?: number;
}
export interface MessageSearchResult extends JournalMessage { rank?: number; }
export interface MessageRepository {
  append(message: JournalMessage): boolean;
  recent(channelId: string, limit?: number): JournalMessage[];
  search(query: string, options?: { channelId?: string; limit?: number }): MessageSearchResult[];
}

export function createMessageRepository(db: DatabaseHandle): MessageRepository {
  const insert = db.raw.prepare(`INSERT OR IGNORE INTO messages
    (id, channel_id, thread_id, task_id, author_id, role, content, created_at, edited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  function row(value: any): JournalMessage {
    return { id: value.id, channelId: value.channel_id, ...(value.thread_id ? { threadId: value.thread_id } : {}),
      ...(value.task_id ? { taskId: value.task_id } : {}), authorId: value.author_id, role: value.role,
      content: value.content, createdAt: value.created_at, ...(value.edited_at ? { editedAt: value.edited_at } : {}) };
  }
  return {
    append(message) {
      return insert.run(message.id, message.channelId, message.threadId ?? null, message.taskId ?? null,
        message.authorId, message.role, message.content, message.createdAt, message.editedAt ?? null).changes === 1;
    },
    recent(channelId, limit = 20) {
      const rows = db.raw.prepare(`SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC, row_id DESC LIMIT ?`).all(channelId, limit) as any[];
      return rows.reverse().map(row);
    },
    search(query, options = {}) {
      if (!query.trim()) return [];
      const limit = options.limit ?? 12;
      const rows = options.channelId
        ? db.raw.prepare(`SELECT m.*, bm25(messages_fts) rank FROM messages_fts JOIN messages m ON m.row_id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.channel_id = ? ORDER BY rank LIMIT ?`).all(query, options.channelId, limit)
        : db.raw.prepare(`SELECT m.*, bm25(messages_fts) rank FROM messages_fts JOIN messages m ON m.row_id = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`).all(query, limit);
      return (rows as any[]).map(value => ({ ...row(value), rank: value.rank }));
    },
  };
}

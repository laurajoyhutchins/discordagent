import type { Migration } from './migrations.js';

export const CHATGPT_SESSION_MIGRATION: Migration = {
  version: 14,
  name: 'persist metadata-only ChatGPT session bindings',
  statements: [
    `CREATE TABLE chatgpt_session_bindings (
      id TEXT PRIMARY KEY,
      discord_thread_id TEXT NOT NULL,
      chatgpt_conversation_id TEXT NOT NULL,
      bound_by TEXT NOT NULL,
      bound_at INTEGER NOT NULL,
      retired_at INTEGER,
      CHECK (length(discord_thread_id) > 0),
      CHECK (length(chatgpt_conversation_id) > 0),
      CHECK (length(bound_by) > 0),
      CHECK (retired_at IS NULL OR retired_at >= bound_at)
    )`,
    `CREATE UNIQUE INDEX chatgpt_session_active_thread_idx
      ON chatgpt_session_bindings(discord_thread_id)
      WHERE retired_at IS NULL`,
    `CREATE UNIQUE INDEX chatgpt_session_active_conversation_idx
      ON chatgpt_session_bindings(chatgpt_conversation_id)
      WHERE retired_at IS NULL`,
    `CREATE INDEX chatgpt_session_thread_history_idx
      ON chatgpt_session_bindings(discord_thread_id, bound_at, id)`,
  ],
};

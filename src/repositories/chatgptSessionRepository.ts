import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '../db/database.js';

export interface ChatgptSessionBinding {
  readonly id: string;
  readonly discordThreadId: string;
  readonly chatgptConversationId: string;
  readonly chatgptConversationUrl: string;
  readonly boundBy: string;
  readonly boundAt: number;
  readonly retiredAt?: number;
}

export interface BindChatgptSessionInput {
  readonly discordThreadId: string;
  readonly chatgptConversationId: string;
  readonly boundBy: string;
  readonly boundAt?: number;
}

export interface ChatgptSessionRepository {
  bind(input: BindChatgptSessionInput): ChatgptSessionBinding;
  findActiveByThreadId(discordThreadId: string): ChatgptSessionBinding | undefined;
  findActiveByConversationId(chatgptConversationId: string): ChatgptSessionBinding | undefined;
  retireByThreadId(discordThreadId: string, retiredAt?: number): ChatgptSessionBinding | undefined;
}

interface ChatgptSessionBindingRow {
  id: string;
  discord_thread_id: string;
  chatgpt_conversation_id: string;
  bound_by: string;
  bound_at: number;
  retired_at: number | null;
}

const SELECT_BINDING = `
  SELECT
    id,
    discord_thread_id,
    chatgpt_conversation_id,
    bound_by,
    bound_at,
    retired_at
  FROM chatgpt_session_bindings
`;

function canonicalConversationUrl(conversationId: string): string {
  return `https://chatgpt.com/c/${conversationId}`;
}

function toRecord(row: ChatgptSessionBindingRow): ChatgptSessionBinding {
  return {
    id: row.id,
    discordThreadId: row.discord_thread_id,
    chatgptConversationId: row.chatgpt_conversation_id,
    chatgptConversationUrl: canonicalConversationUrl(row.chatgpt_conversation_id),
    boundBy: row.bound_by,
    boundAt: row.bound_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function createChatgptSessionRepository(db: DatabaseHandle): ChatgptSessionRepository {
  const selectActiveByThread = db.raw.prepare(`${SELECT_BINDING}
    WHERE discord_thread_id = ? AND retired_at IS NULL
    LIMIT 1
  `);
  const selectActiveByConversation = db.raw.prepare(`${SELECT_BINDING}
    WHERE chatgpt_conversation_id = ? AND retired_at IS NULL
    LIMIT 1
  `);
  const selectById = db.raw.prepare(`${SELECT_BINDING} WHERE id = ? LIMIT 1`);

  function findActiveByThreadId(discordThreadId: string): ChatgptSessionBinding | undefined {
    const row = selectActiveByThread.get(discordThreadId) as ChatgptSessionBindingRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  function findActiveByConversationId(chatgptConversationId: string): ChatgptSessionBinding | undefined {
    const row = selectActiveByConversation.get(chatgptConversationId) as ChatgptSessionBindingRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  return {
    bind(input): ChatgptSessionBinding {
      const discordThreadId = requireText(input.discordThreadId, 'Discord thread ID');
      const chatgptConversationId = requireText(input.chatgptConversationId, 'ChatGPT conversation ID');
      const boundBy = requireText(input.boundBy, 'Binding principal');
      const boundAt = input.boundAt ?? Date.now();
      if (!Number.isSafeInteger(boundAt) || boundAt < 0) {
        throw new Error('Binding timestamp must be a non-negative safe integer');
      }

      const threadBinding = findActiveByThreadId(discordThreadId);
      if (threadBinding) {
        if (threadBinding.chatgptConversationId === chatgptConversationId) return threadBinding;
        throw new Error('This Discord thread is already bound to another ChatGPT conversation. Unbind it first.');
      }

      const conversationBinding = findActiveByConversationId(chatgptConversationId);
      if (conversationBinding) {
        throw new Error('This ChatGPT conversation is already bound to another Discord thread.');
      }

      const id = randomUUID();
      db.raw.prepare(`
        INSERT INTO chatgpt_session_bindings (
          id, discord_thread_id, chatgpt_conversation_id, bound_by, bound_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(id, discordThreadId, chatgptConversationId, boundBy, boundAt);

      const row = selectById.get(id) as ChatgptSessionBindingRow | undefined;
      if (!row) throw new Error('ChatGPT session binding was not persisted');
      return toRecord(row);
    },

    findActiveByThreadId,
    findActiveByConversationId,

    retireByThreadId(discordThreadId, retiredAt = Date.now()): ChatgptSessionBinding | undefined {
      const active = findActiveByThreadId(discordThreadId);
      if (!active) return undefined;
      if (!Number.isSafeInteger(retiredAt) || retiredAt < active.boundAt) {
        throw new Error('Retirement timestamp must not precede the binding timestamp');
      }

      const result = db.raw.prepare(`
        UPDATE chatgpt_session_bindings
        SET retired_at = ?
        WHERE id = ? AND retired_at IS NULL
      `).run(retiredAt, active.id);
      if (result.changes !== 1) return undefined;

      const row = selectById.get(active.id) as ChatgptSessionBindingRow | undefined;
      return row ? toRecord(row) : undefined;
    },
  };
}

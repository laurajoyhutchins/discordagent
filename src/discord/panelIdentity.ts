export type PanelKind = 'settings' | 'project-settings' | 'codex-auth';

export interface PanelIdentityKey {
  kind: PanelKind;
  userId: string;
  channelId: string;
}

interface PanelMessageLike {
  id?: unknown;
  channelId?: unknown;
  author?: { bot?: unknown; id?: unknown } | null;
  components?: readonly unknown[];
}

interface PanelRecord {
  messageId: string;
  channelId: string;
  authorId?: string;
  schema: string;
}

export interface PanelIdentityRegistry {
  register(key: PanelIdentityKey, message: PanelMessageLike, components: readonly unknown[]): void;
  matches(key: PanelIdentityKey, message: PanelMessageLike | null | undefined): boolean;
  clear(key: PanelIdentityKey): void;
}

function keyOf(key: PanelIdentityKey): string {
  return `${key.kind}:${key.userId}:${key.channelId}`;
}

function serializedComponent(component: unknown): unknown {
  if (typeof component === 'object' && component !== null && 'toJSON' in component) {
    const toJSON = (component as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return toJSON.call(component);
  }
  return component;
}

export function componentSchema(components: readonly unknown[] | undefined): string {
  return JSON.stringify((components ?? []).map(serializedComponent));
}

export function createPanelIdentityRegistry(): PanelIdentityRegistry {
  const records = new Map<string, PanelRecord>();
  return {
    register(key, message, components) {
      if (!message || typeof message.id !== 'string' || !message.id || typeof message.channelId !== 'string' || !message.channelId) return;
      records.set(keyOf(key), {
        messageId: message.id,
        channelId: message.channelId,
        ...(typeof message.author?.id === 'string' ? { authorId: message.author.id } : {}),
        schema: componentSchema(components),
      });
    },
    matches(key, message) {
      const record = records.get(keyOf(key));
      if (!record || !message || typeof message.id !== 'string' || typeof message.channelId !== 'string') return false;
      if (message.id !== record.messageId || message.channelId !== record.channelId || message.author?.bot !== true) return false;
      if (record.authorId !== undefined && message.author?.id !== record.authorId) return false;
      return componentSchema(message.components) === record.schema;
    },
    clear(key) {
      records.delete(keyOf(key));
    },
  };
}

export const panelIdentityRegistry = createPanelIdentityRegistry();

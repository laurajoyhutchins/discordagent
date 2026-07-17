import type { AgentProviderId } from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';

const DEFAULT_PROVIDER_KEY = 'default_provider';

export interface SettingsRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  getDefaultProvider(): AgentProviderId | undefined;
  setDefaultProvider(provider: AgentProviderId): void;
}

export function createSettingsRepository(db: DatabaseHandle): SettingsRepository {
  const read = db.raw.prepare('SELECT value FROM runtime_settings WHERE key = ?');
  const write = db.raw.prepare(`
    INSERT INTO runtime_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  return {
    get(key: string): string | undefined {
      const row = read.get(key) as { value?: string } | undefined;
      return row?.value;
    },
    set(key: string, value: string): void {
      write.run(key, value, Date.now());
    },
    getDefaultProvider(): AgentProviderId | undefined {
      const value = this.get(DEFAULT_PROVIDER_KEY);
      return value === 'claude' || value === 'codex' ? value : undefined;
    },
    setDefaultProvider(provider: AgentProviderId): void {
      this.set(DEFAULT_PROVIDER_KEY, provider);
    },
  };
}

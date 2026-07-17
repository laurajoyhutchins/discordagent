import { REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';
import { validateClaudeTimeout, validateUsageReserve } from '../settings/validation.js';

const DEFAULT_PROVIDER_KEY = 'default_provider';
const PRIMARY_AGENT_MODEL_KEY = 'primary_agent_model';
const CLAUDE_TIMEOUT_KEY = 'claude_timeout_ms';
const USAGE_RESERVE_KEY = 'usage_reserve';

export interface SettingsRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  getDefaultProvider(): AgentProviderId | undefined;
  setDefaultProvider(provider: AgentProviderId): void;
  getModel(provider: AgentProviderId): string | undefined;
  setModel(provider: AgentProviderId, model?: string): void;
  getDefaultModel(provider: AgentProviderId): string | undefined;
  setDefaultModel(provider: AgentProviderId, model?: string): void;
  getPrimaryAgentModel(): string | undefined;
  setPrimaryAgentModel(model?: string): void;
  getClaudeTimeout(): number | undefined;
  setClaudeTimeout(timeoutMs?: number): void;
  getClaudeTimeoutMs(): number | undefined;
  setClaudeTimeoutMs(timeoutMs?: number): void;
  getUsageReserve(): number | undefined;
  setUsageReserve(reserve?: number): void;
  getReasoningEffort(provider: AgentProviderId): ReasoningEffort | undefined;
  setReasoningEffort(provider: AgentProviderId, effort?: ReasoningEffort): void;
}

function modelKey(provider: AgentProviderId): string { return `model:${provider}`; }
function reasoningKey(provider: AgentProviderId): string { return `reasoning_effort:${provider}`; }

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
    getModel(provider: AgentProviderId): string | undefined {
      const value = this.get(modelKey(provider));
      return value || undefined;
    },
    setModel(provider: AgentProviderId, model?: string): void {
      this.set(modelKey(provider), model ?? '');
    },
    getDefaultModel(provider: AgentProviderId): string | undefined {
      return this.getModel(provider);
    },
    setDefaultModel(provider: AgentProviderId, model?: string): void {
      this.setModel(provider, model);
    },
    getPrimaryAgentModel(): string | undefined {
      return this.get(PRIMARY_AGENT_MODEL_KEY) || undefined;
    },
    setPrimaryAgentModel(model?: string): void {
      this.set(PRIMARY_AGENT_MODEL_KEY, model ?? '');
    },
    getClaudeTimeout(): number | undefined {
      const value = this.get(CLAUDE_TIMEOUT_KEY);
      if (!value) return undefined;
      const parsed = Number(value);
      try { return validateClaudeTimeout(parsed); } catch { return undefined; }
    },
    setClaudeTimeout(timeoutMs?: number): void {
      this.set(CLAUDE_TIMEOUT_KEY, timeoutMs === undefined ? '' : String(validateClaudeTimeout(timeoutMs)));
    },
    getClaudeTimeoutMs(): number | undefined {
      return this.getClaudeTimeout();
    },
    setClaudeTimeoutMs(timeoutMs?: number): void {
      this.setClaudeTimeout(timeoutMs);
    },
    getUsageReserve(): number | undefined {
      const value = this.get(USAGE_RESERVE_KEY);
      if (!value) return undefined;
      const parsed = Number(value);
      try { return validateUsageReserve(parsed); } catch { return undefined; }
    },
    setUsageReserve(reserve?: number): void {
      this.set(USAGE_RESERVE_KEY, reserve === undefined ? '' : String(validateUsageReserve(reserve)));
    },
    getReasoningEffort(provider: AgentProviderId): ReasoningEffort | undefined {
      const value = this.get(reasoningKey(provider));
      return value && REASONING_EFFORTS.includes(value as ReasoningEffort)
        ? value as ReasoningEffort
        : undefined;
    },
    setReasoningEffort(provider: AgentProviderId, effort?: ReasoningEffort): void {
      this.set(reasoningKey(provider), effort ?? '');
    },
  };
}

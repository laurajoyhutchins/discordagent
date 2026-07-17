const MIN_CLAUDE_TIMEOUT_MS = 5_000;
const MAX_CLAUDE_TIMEOUT_MS = 3_600_000;
const MIN_USAGE_RESERVE = 0;
const MAX_USAGE_RESERVE = 50;

export function validateClaudeTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_CLAUDE_TIMEOUT_MS || timeoutMs > MAX_CLAUDE_TIMEOUT_MS) {
    throw new Error(`Claude timeout must be between ${MIN_CLAUDE_TIMEOUT_MS} and ${MAX_CLAUDE_TIMEOUT_MS} milliseconds`);
  }
  return timeoutMs;
}

export function validateUsageReserve(reserve: number): number {
  if (!Number.isFinite(reserve) || reserve < MIN_USAGE_RESERVE || reserve > MAX_USAGE_RESERVE) {
    throw new Error(`Usage reserve must be between ${MIN_USAGE_RESERVE} and ${MAX_USAGE_RESERVE} percent`);
  }
  return reserve;
}

export function validateModelOverride(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  if (typeof model !== 'string') throw new Error('Model override must be a string');
  const normalized = model.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function validateMcpProfile(
  profile: string | undefined,
  allowedProfiles: readonly string[],
): string | undefined {
  if (profile === undefined) return undefined;
  if (typeof profile !== 'string') throw new Error('MCP profile must be a string');
  const normalized = profile.trim();
  if (!allowedProfiles.includes(normalized)) {
    throw new Error(`Unknown MCP profile: ${profile}`);
  }
  return normalized;
}

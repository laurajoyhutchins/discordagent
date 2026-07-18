import type { AgentProviderId } from '../agents/contracts.js';
import { redactErrorMessage } from './redaction.js';

export function optionalPrimary(read: () => string): string | undefined {
  try { return read(); } catch { return undefined; }
}

export function providerUnavailable(provider: AgentProviderId): string {
  return `${provider === 'codex' ? 'Codex' : 'Claude'} is unavailable on this host. Try again later or contact the bot owner.`;
}

export async function safeProviderCheck<T extends { checkProvider?(provider: AgentProviderId): Promise<{ available: boolean }> }>(
  dependencies: T,
  provider: AgentProviderId,
  fallbackAvailable = true,
): Promise<{ available: boolean }> {
  if (!dependencies.checkProvider) return { available: fallbackAvailable };
  try {
    const result = await dependencies.checkProvider(provider);
    return { available: result.available };
  } catch (error) {
    console.error(`[provider] Availability check failed for ${provider}:`, redactErrorMessage(error));
    return { available: false };
  }
}

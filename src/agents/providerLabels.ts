import type { AgentProviderId } from './contracts.js';

export function providerLabel(provider: AgentProviderId): string {
  return provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'OpenCode';
}

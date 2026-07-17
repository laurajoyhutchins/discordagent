import { describe, expect, it } from 'vitest';
import type { AgentProvider, AgentProviderId } from './contracts.js';
import { ProviderRegistry } from './providerRegistry.js';

function provider(id: AgentProviderId): AgentProvider {
  return {
    id,
    async checkAvailability() { return { available: true }; },
    async startTask() { throw new Error('not used'); },
    async continueTask() { throw new Error('not used'); },
    async cancelTask() {},
    async estimateHandoff() {
      return { estimatedInputTokens: 1, confidence: 'high', explanation: 'test' };
    },
  };
}

describe('ProviderRegistry', () => {
  it('returns the exact provider registered for an identifier', () => {
    const registry = new ProviderRegistry();
    const claude = provider('claude');
    const codex = provider('codex');
    registry.register(claude);
    registry.register(codex);

    expect(registry.require('claude')).toBe(claude);
    expect(registry.require('codex')).toBe(codex);
  });

  it('rejects duplicate registration and missing providers', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('claude'));

    expect(() => registry.register(provider('claude'))).toThrow(/already registered/i);
    expect(() => registry.require('codex')).toThrow(/not registered/i);
  });

  it('delegates availability checks deterministically', async () => {
    const registry = new ProviderRegistry();
    const claude = provider('claude');
    claude.checkAvailability = async () => ({
      available: false,
      reason: 'authentication required',
      authenticationRequired: true,
    });
    registry.register(claude);

    await expect(registry.availability('claude')).resolves.toEqual({
      available: false,
      reason: 'authentication required',
      authenticationRequired: true,
    });
  });

  it('lists only the providers that are registered', () => {
    const registry = new ProviderRegistry();
    registry.register(provider('codex'));

    expect(registry.list()).toEqual(['codex']);
  });
});

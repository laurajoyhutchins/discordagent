import { describe, expect, it } from 'vitest';
import type { AgentProviderId, ProviderAvailability } from '../agents/contracts.js';
import {
  areRequiredProvidersReady,
  parseRequiredProviders,
  startProductionHealth,
  type ProviderAvailabilitySource,
} from './productionHealth.js';

function providerSource(
  registered: AgentProviderId[],
  availability: Partial<Record<AgentProviderId, ProviderAvailability | Error>>,
): ProviderAvailabilitySource {
  return {
    list: () => registered,
    availability: async provider => {
      const result = availability[provider];
      if (result instanceof Error) throw result;
      return result ?? { available: false };
    },
  };
}

describe('production health lifecycle', () => {
  it('holds readiness false until runtime, provider, and Discord are ready', async () => {
    const health = await startProductionHealth({ host: '127.0.0.1', port: 0 });

    try {
      expect(health.server.snapshot()).toMatchObject({
        live: true,
        ready: false,
        recoveryReady: false,
        storageReady: false,
        discordReady: false,
        providerReady: false,
      });

      health.markRuntimeReady(true);
      expect(health.server.snapshot()).toMatchObject({
        ready: false,
        recoveryReady: true,
        storageReady: true,
        discordReady: false,
        providerReady: true,
      });

      health.markDiscordReady();
      expect(health.server.snapshot().ready).toBe(true);

      health.markDiscordUnavailable();
      expect(health.server.snapshot()).toMatchObject({
        ready: false,
        discordReady: false,
      });
    } finally {
      await health.close();
    }
  });

  it('lowers and restores readiness when a required provider changes state', async () => {
    const health = await startProductionHealth({ host: '127.0.0.1', port: 0 });

    try {
      health.markRuntimeReady(true);
      health.markDiscordReady();
      expect(health.server.snapshot().ready).toBe(true);

      health.markProviderReady(false);
      expect(health.server.snapshot()).toMatchObject({
        ready: false,
        providerReady: false,
        recoveryReady: true,
        storageReady: true,
        discordReady: true,
      });

      health.markProviderReady(true);
      expect(health.server.snapshot().ready).toBe(true);
    } finally {
      await health.close();
    }
  });

  it('lowers every readiness dependency before graceful shutdown', async () => {
    const health = await startProductionHealth({ host: '127.0.0.1', port: 0 });

    try {
      health.markRuntimeReady(true);
      health.markDiscordReady();
      expect(health.server.snapshot().ready).toBe(true);

      health.beginShutdown();
      expect(health.server.snapshot()).toMatchObject({
        live: true,
        ready: false,
        recoveryReady: false,
        storageReady: false,
        discordReady: false,
        providerReady: false,
      });
    } finally {
      await health.close();
    }
  });
});

describe('required provider readiness', () => {
  it('normalizes and deduplicates the production provider contract', () => {
    expect(parseRequiredProviders(' codex,CLAUDE,codex ')).toEqual(['codex', 'claude']);
  });

  it('rejects unsupported provider names', () => {
    expect(() => parseRequiredProviders('codex,typo')).toThrow(
      'REQUIRED_PROVIDERS contains unsupported provider "typo".',
    );
  });

  it('reports ready only when every required provider is registered and available', async () => {
    const providers = providerSource(
      ['codex', 'claude'],
      {
        codex: { available: true },
        claude: { available: true },
      },
    );

    await expect(areRequiredProvidersReady(providers, ['codex', 'claude'])).resolves.toBe(true);
    await expect(areRequiredProvidersReady(providers, ['codex', 'opencode'])).resolves.toBe(false);
  });

  it('fails closed when an availability probe throws or reports unavailable', async () => {
    const throwing = providerSource(['codex'], { codex: new Error('probe failed') });
    const unavailable = providerSource(['codex'], { codex: { available: false } });

    await expect(areRequiredProvidersReady(throwing, ['codex'])).resolves.toBe(false);
    await expect(areRequiredProvidersReady(unavailable, ['codex'])).resolves.toBe(false);
  });
});

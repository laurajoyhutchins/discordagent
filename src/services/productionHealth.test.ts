import { describe, expect, it } from 'vitest';
import { startProductionHealth } from './productionHealth.js';

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

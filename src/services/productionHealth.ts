import {
  startHealthServer,
  type HealthServerHandle,
  type StartHealthServerOptions,
} from './healthServer.js';

export interface ProductionHealthHandle {
  readonly server: HealthServerHandle;
  markRuntimeReady(providerReady: boolean): void;
  markDiscordReady(): void;
  markDiscordUnavailable(): void;
  beginShutdown(): void;
  close(): Promise<void>;
}

/**
 * Owns the production health state transitions used by the process entrypoint.
 *
 * The server starts live but not ready. Runtime recovery and storage become
 * ready together only after `startRuntime` completes. Discord and provider
 * readiness remain independent so reconnects and provider failures can lower
 * readiness without making the process appear dead.
 */
export async function startProductionHealth(
  options: StartHealthServerOptions = {},
): Promise<ProductionHealthHandle> {
  const server = await startHealthServer(options);

  return {
    server,
    markRuntimeReady(providerReady: boolean): void {
      server.update({
        recoveryReady: true,
        storageReady: true,
        providerReady,
      });
    },
    markDiscordReady(): void {
      server.update({ discordReady: true });
    },
    markDiscordUnavailable(): void {
      server.update({ discordReady: false });
    },
    beginShutdown(): void {
      server.update({
        recoveryReady: false,
        storageReady: false,
        discordReady: false,
        providerReady: false,
      });
    },
    close(): Promise<void> {
      return server.close();
    },
  };
}

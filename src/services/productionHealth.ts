import { AGENT_PROVIDER_IDS, type AgentProviderId, type ProviderAvailability } from '../agents/contracts.js';
import {
  startHealthServer,
  type HealthServerHandle,
  type StartHealthServerOptions,
} from './healthServer.js';

export interface ProviderAvailabilitySource {
  list(): AgentProviderId[];
  availability(id: AgentProviderId): Promise<ProviderAvailability>;
}

export interface ProductionHealthHandle {
  readonly server: HealthServerHandle;
  markRuntimeReady(providerReady: boolean): void;
  markDiscordReady(): void;
  markDiscordUnavailable(): void;
  beginShutdown(): void;
  close(): Promise<void>;
}

/**
 * Parse the production provider contract. Unknown values fail closed so a
 * misspelled provider cannot accidentally produce a ready process.
 */
export function parseRequiredProviders(
  value: string | undefined = process.env.REQUIRED_PROVIDERS,
): AgentProviderId[] {
  if (!value?.trim()) return [];

  const supported = new Set<string>(AGENT_PROVIDER_IDS);
  const providers = [...new Set(
    value
      .split(',')
      .map(provider => provider.trim().toLowerCase())
      .filter(Boolean),
  )];

  const unsupported = providers.find(provider => !supported.has(provider));
  if (unsupported) {
    throw new Error(`REQUIRED_PROVIDERS contains unsupported provider "${unsupported}".`);
  }

  return providers as AgentProviderId[];
}

/**
 * Resolve the required-provider readiness gate from the live provider registry.
 * Missing providers, failed availability probes, and unavailable providers all
 * lower readiness without making the process appear dead.
 */
export async function areRequiredProvidersReady(
  providers: ProviderAvailabilitySource,
  required: readonly AgentProviderId[] = parseRequiredProviders(),
): Promise<boolean> {
  const registered = new Set(providers.list());
  if (required.some(provider => !registered.has(provider))) return false;

  const availability = await Promise.all(required.map(async provider => {
    try {
      return await providers.availability(provider);
    } catch {
      return { available: false } satisfies ProviderAvailability;
    }
  }));

  return availability.every(result => result.available);
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

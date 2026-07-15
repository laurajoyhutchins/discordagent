import type {
  AgentProvider,
  AgentProviderId,
  ProviderAvailability,
} from './contracts.js';

export class ProviderRegistry {
  private readonly providers = new Map<AgentProviderId, AgentProvider>();

  register(provider: AgentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Agent provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  require(id: AgentProviderId): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Agent provider "${id}" is not registered`);
    return provider;
  }

  availability(id: AgentProviderId): Promise<ProviderAvailability> {
    return this.require(id).checkAvailability();
  }
}

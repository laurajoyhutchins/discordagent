import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import type { AgentProvider, AgentProviderId } from '../agents/contracts.js';
import { createProviderOnboardingService } from './providerOnboarding.js';

function provider(id: AgentProviderId): AgentProvider {
  return {
    id,
    checkAvailability: vi.fn(async () => ({ available: true })),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
  } as never;
}

describe('provider onboarding with OpenCode PM support', () => {
  it('offers and persists OpenCode as a PM provider', async () => {
    const values = new Map<string, string>();
    const settings = {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => { values.set(key, value); },
      getDefaultProvider: () => values.get('default_provider') as AgentProviderId | undefined,
      setDefaultProvider: (value: AgentProviderId) => { values.set('default_provider', value); },
    };
    const providers = new ProviderRegistry();
    providers.register(provider('opencode'));
    const channel = {
      send: vi.fn(async () => ({ id: 'setup-message' })),
      messages: { fetch: vi.fn(async () => null) },
    };
    const onSelected = vi.fn(async () => undefined);
    const service = createProviderOnboardingService({
      ownerId: 'owner',
      settings: settings as never,
      providers,
      channel: channel as never,
      onSelected,
    });

    await service.ensurePrompt();
    const payload = channel.send.mock.calls[0][0] as unknown as {
      components: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }>;
    };
    const customIds = payload.components.flatMap(row => row.toJSON().components.map(component => component.custom_id));
    expect(customIds).toContain('provider_setup:opencode');

    const update = vi.fn(async () => undefined);
    await expect(service.handleButton({
      customId: 'provider_setup:opencode',
      user: { id: 'owner' },
      update,
    } as never)).resolves.toBe(true);

    expect(onSelected).toHaveBeenCalledWith('opencode');
    expect(settings.getDefaultProvider()).toBe('opencode');
  });
});

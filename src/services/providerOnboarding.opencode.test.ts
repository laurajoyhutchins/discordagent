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
    const global = () => ({ defaultProvider: values.get('default_provider') as AgentProviderId | undefined });
    const settings = {
      global,
      updateGlobalWithActivation: vi.fn(async (input: { defaultProvider?: AgentProviderId }, activate: () => Promise<void>) => {
        await activate();
        if (input.defaultProvider) values.set('default_provider', input.defaultProvider);
        return global();
      }),
    };
    const metadata = {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => { values.set(key, value); },
    };
    const providers = new ProviderRegistry();
    providers.register(provider('opencode'));
    let sentMessage: any;
    const channel = {
      id: 'agent-chat',
      send: vi.fn(async (payload: any) => {
        sentMessage = {
          id: 'setup-message',
          channelId: 'agent-chat',
          author: { id: 'bot', bot: true },
          content: payload.content,
          components: payload.components.map((row: any) => {
            const json = row.toJSON();
            return {
              components: json.components.map((component: any) => ({
                customId: component.custom_id,
                type: component.type,
                style: component.style,
                label: component.label,
              })),
            };
          }),
          edit: vi.fn(async () => undefined),
        };
        return sentMessage;
      }),
      messages: { fetch: vi.fn(async () => null) },
    };
    const onSelected = vi.fn(async () => undefined);
    const service = createProviderOnboardingService({
      ownerId: 'owner',
      settings: settings as never,
      metadata,
      providers,
      channel: channel as never,
      botUserId: 'bot',
      onSelected,
    });

    await service.ensurePrompt();
    const payload = channel.send.mock.calls[0][0] as any;
    const customIds = payload.components.flatMap((row: any) => row.toJSON().components.map((component: any) => component.custom_id));
    expect(customIds).toContain('provider_setup:opencode');

    const update = vi.fn(async () => undefined);
    await expect(service.handleButton({
      customId: 'provider_setup:opencode',
      user: { id: 'owner' },
      channelId: 'agent-chat',
      message: sentMessage,
      update,
      reply: vi.fn(async () => undefined),
    } as never)).resolves.toBe(true);

    expect(onSelected).toHaveBeenCalledWith('opencode');
    expect(global().defaultProvider).toBe('opencode');
  });
});

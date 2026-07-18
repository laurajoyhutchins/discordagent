import { describe, expect, it, vi } from 'vitest';
import type { AgentProvider } from '../agents/contracts.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { createProviderOnboardingService } from './providerOnboarding.js';

function provider(id: 'claude' | 'codex'): AgentProvider {
  return {
    id,
    checkAvailability: vi.fn(async () => ({ available: true })),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
  } as never;
}

describe('provider onboarding activation retry', () => {
  it('keeps provider controls available when activation fails', async () => {
    const values = new Map<string, string>();
    const metadata = {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => { values.set(key, value); },
    };
    const registry = new ProviderRegistry();
    registry.register(provider('claude'));
    registry.register(provider('codex'));
    const message = {
      id: 'setup-message',
      channelId: 'primary-channel',
      author: { id: 'bot-1', bot: true },
      edit: vi.fn(async () => undefined),
    };
    const channel = {
      id: 'primary-channel',
      send: vi.fn(async () => message),
      messages: { fetch: vi.fn(async () => message) },
    };
    const service = createProviderOnboardingService({
      ownerId: 'owner',
      settings: {
        global: () => ({}),
        updateGlobalWithActivation: vi.fn(async () => {
          throw new Error('activation failed');
        }),
      } as never,
      metadata: metadata as never,
      providers: registry,
      channel: channel as never,
      botUserId: 'bot-1',
    });

    await service.ensurePrompt();
    const deferUpdate = vi.fn(async () => undefined);
    const editReply = vi.fn(async (_payload: unknown) => undefined);
    await service.handleButton({
      customId: 'provider_setup:codex',
      user: { id: 'owner' },
      channelId: 'primary-channel',
      message: {
        id: message.id,
        channelId: 'primary-channel',
        author: message.author,
        components: [{ components: [
          { type: 2, style: 1, customId: 'provider_setup:claude', label: 'Claude' },
          { type: 2, style: 1, customId: 'provider_setup:codex', label: 'Codex' },
        ] }],
      },
      deferUpdate,
      editReply,
    } as never);

    expect(deferUpdate).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/could not be activated/i),
      components: expect.any(Array),
    }));
    const payload = editReply.mock.calls[0]?.[0] as {
      components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }>;
    } | undefined;
    expect(payload).toBeDefined();
    const firstRow = payload?.components[0];
    expect(firstRow).toBeDefined();
    const buttonIds = firstRow!.toJSON().components.map(component => component.custom_id);
    expect(buttonIds).toEqual(expect.arrayContaining(['provider_setup:claude', 'provider_setup:codex']));
  });
});

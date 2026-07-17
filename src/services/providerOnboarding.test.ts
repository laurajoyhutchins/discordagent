import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import type { AgentProvider } from '../agents/contracts.js';
import { createProviderOnboardingService } from './providerOnboarding.js';

function provider(id: 'claude' | 'codex', available = true): AgentProvider {
  return {
    id,
    checkAvailability: vi.fn(async () => available
      ? { available: true }
      : { available: false, authenticationRequired: true, reason: 'Sign-in required' }),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
  } as never;
}

function setup() {
  const values = new Map<string, string>();
  const settings = {
    get: (key: string) => values.get(key),
    set: (key: string, value: string) => { values.set(key, value); },
    getDefaultProvider: () => values.get('default_provider') as 'claude' | 'codex' | undefined,
    setDefaultProvider: (provider: 'claude' | 'codex') => { values.set('default_provider', provider); },
  };
  const registry = new ProviderRegistry();
  registry.register(provider('codex'));
  registry.register(provider('claude'));
  const message = { id: 'setup-message', edit: vi.fn(async () => undefined) };
  const channel = {
    send: vi.fn(async () => message),
    messages: { fetch: vi.fn(async () => message) },
  };
  return { settings, registry, channel, message };
}

describe('provider onboarding', () => {
  it('posts one idempotent provider selection prompt', async () => {
    const context = setup();
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settings as never, providers: context.registry, channel: context.channel as never,
    });

    await service.ensurePrompt();
    await service.ensurePrompt();

    expect(context.channel.send).toHaveBeenCalledOnce();
    expect(context.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/choose.*provider/i),
      components: expect.any(Array),
    }));
  });

  it('persists an owner-selected provider and removes the setup controls', async () => {
    const context = setup();
    const onSelected = vi.fn(async () => undefined);
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settings as never, providers: context.registry, channel: context.channel as never, onSelected,
    });
    await service.ensurePrompt();
    const update = vi.fn(async () => undefined);

    await expect(service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, update,
    } as never)).resolves.toBe(true);

    expect(context.settings.getDefaultProvider()).toBe('codex');
    expect(onSelected).toHaveBeenCalledWith('codex');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/Codex.*default/i), components: [] }));
  });

  it('instructs the owner to authenticate an unavailable provider', async () => {
    const context = setup();
    context.registry = new ProviderRegistry();
    context.registry.register(provider('codex', false));
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settings as never, providers: context.registry, channel: context.channel as never,
    });
    const reply = vi.fn(async () => undefined);

    await expect(service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, reply,
    } as never)).resolves.toBe(true);

    expect(context.settings.getDefaultProvider()).toBeUndefined();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/sign-in required/i), ephemeral: true }));
  });
});

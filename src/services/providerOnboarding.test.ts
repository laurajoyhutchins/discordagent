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
  const message = { id: 'setup-message', channelId: 'primary-channel', author: { id: 'bot-1', bot: true }, edit: vi.fn(async () => undefined) };
  const channel = {
    id: 'primary-channel',
    send: vi.fn(async () => message),
    messages: { fetch: vi.fn(async () => message) },
  };
  const settingsService = {
    global: () => ({ ...(settings.getDefaultProvider() ? { defaultProvider: settings.getDefaultProvider() } : {}) }),
    updateGlobalWithActivation: vi.fn(async (input: { defaultProvider?: 'claude' | 'codex' }, activate: () => Promise<void>) => {
      await activate();
      if (input.defaultProvider) settings.setDefaultProvider(input.defaultProvider);
      return settingsService.global();
    }),
  };
  return { settings, settingsService, registry, channel, message };
}

describe('provider onboarding', () => {
  it('posts one idempotent provider selection prompt', async () => {
    const context = setup();
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings, providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
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
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings, providers: context.registry, channel: context.channel as never, botUserId: 'bot-1', onSelected,
    });
    await service.ensurePrompt();
    const update = vi.fn(async () => undefined);

    await expect(service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, channelId: 'primary-channel', message: { id: context.message.id, channelId: 'primary-channel', author: { id: 'bot-1', bot: true }, components: [{ components: [{ type: 2, style: 1, customId: 'provider_setup:codex', label: 'Codex' }] }] }, update,
    } as never)).resolves.toBe(true);

    expect(context.settings.getDefaultProvider()).toBe('codex');
    expect(context.settingsService.updateGlobalWithActivation).toHaveBeenCalledWith({ defaultProvider: 'codex' }, expect.any(Function), undefined);
    expect(onSelected).toHaveBeenCalledWith('codex');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/Codex.*default/i), components: [] }));
  });

  it('refreshes an old no-button prompt when providers become available', async () => {
    const context = setup();
    context.settings.set('provider_setup_message_id', context.message.id);
    (context.message as { content?: string; components?: unknown[] }).content = 'Provider setup required';
    (context.message as { content?: string; components?: unknown[] }).components = [];
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });

    await service.ensurePrompt();

    expect(context.channel.send).not.toHaveBeenCalled();
    expect(context.message.edit).toHaveBeenCalledWith(expect.objectContaining({ components: expect.any(Array) }));
  });

  it('reconciles stale setup controls on restart after a provider is already selected', async () => {
    const context = setup();
    context.settings.set('default_provider', 'codex');
    context.settings.set('provider_setup_message_id', context.message.id);
    (context.message as { content?: string; components?: unknown[] }).content = 'Provider setup required';
    (context.message as { content?: string; components?: unknown[] }).components = [{ components: [{
      type: 2, style: 1, customId: 'provider_setup:codex', label: 'Codex',
    }] }];
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });

    await service.ensurePrompt();

    expect(context.channel.send).not.toHaveBeenCalled();
    expect(context.message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/global provider set/i) }));
  });

  it('shows currently available provider controls when the persisted selection is unavailable', async () => {
    const context = setup();
    context.settings.set('default_provider', 'claude');
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });

    await service.ensurePrompt({ forceSelection: true });

    expect(context.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/choose.*provider/i),
      components: expect.any(Array),
    }));
  });

  it('rejects setup interactions from another channel even for the configured owner', async () => {
    const context = setup();
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });
    const reply = vi.fn(async () => undefined);

    await service.ensurePrompt();

    await service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, channelId: 'wrong-channel', message: { channelId: 'wrong-channel' }, reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/configured owner/i) }));
  });

  it('rejects a stale setup button from an older message in the correct channel', async () => {
    const context = setup();
    context.settings.set('provider_setup_message_id', 'current-message');
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });
    const reply = vi.fn(async () => undefined);

    await service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, channelId: 'primary-channel', message: { id: 'old-message', channelId: 'primary-channel' }, reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/configured owner/i) }));
  });

  it('replaces a persisted setup message that is not bot-authored', async () => {
    const context = setup();
    context.settings.set('provider_setup_message_id', context.message.id);
    (context.message as { author?: { id: string; bot: boolean } }).author = { id: 'human', bot: false };
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });

    await expect(service.ensurePrompt()).rejects.toThrow(/identity validation/i);
    expect(context.message.edit).not.toHaveBeenCalled();
    expect(context.channel.send).not.toHaveBeenCalled();
  });

  it('rejects a bot-authored setup message with a forged provider button schema', async () => {
    const context = setup();
    context.settings.set('provider_setup_message_id', context.message.id);
    (context.message as { components?: unknown[] }).components = [{ components: [{
      type: 2, style: 4, customId: 'provider_setup:codex', label: 'Choose Codex',
    }] }];
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });

    await expect(service.ensurePrompt()).rejects.toThrow(/unexpected controls/i);
    expect(context.message.edit).not.toHaveBeenCalled();
  });

  it('instructs the owner to authenticate an unavailable provider', async () => {
    const context = setup();
    context.registry = new ProviderRegistry();
    context.registry.register(provider('codex', false));
    context.settings.set('provider_setup_message_id', context.message.id);
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings, providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });
    const reply = vi.fn(async () => undefined);

    await expect(service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, channelId: 'primary-channel', message: { channelId: 'primary-channel', id: context.message.id, author: { id: 'bot-1', bot: true }, components: [{ components: [{ type: 2, style: 1, customId: 'provider_setup:codex', label: 'Codex' }] }] }, reply,
    } as never)).resolves.toBe(true);

    expect(context.settings.getDefaultProvider()).toBeUndefined();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/sign-in required/i), ephemeral: true }));
  });

  it('does not expose provider activation errors, secrets, or paths to Discord', async () => {
    const context = setup();
    context.settingsService.updateGlobalWithActivation = vi.fn(async () => {
      throw new Error('activation failed at C:\\secrets\\codex.json API_KEY=onboarding-secret');
    });
    const service = createProviderOnboardingService({
      ownerId: 'owner', settings: context.settingsService as never, metadata: context.settings,
      providers: context.registry, channel: context.channel as never, botUserId: 'bot-1',
    });
    const reply = vi.fn(async () => undefined);

    await service.ensurePrompt();
    await service.handleButton({
      customId: 'provider_setup:codex', user: { id: 'owner' }, channelId: 'primary-channel',
      message: { id: context.message.id, channelId: 'primary-channel', author: { id: 'bot-1', bot: true }, components: [{ components: [{ type: 2, style: 1, customId: 'provider_setup:codex', label: 'Codex' }] }] }, reply,
    } as never);

    const content = String((reply as unknown as { mock: { calls: Array<Array<{ content?: unknown }>> } }).mock.calls[0]?.[0]?.content);
    expect(content).toMatch(/could not be activated/i);
    expect(content).not.toContain('onboarding-secret');
    expect(content).not.toContain('C:\\secrets');
  });
});

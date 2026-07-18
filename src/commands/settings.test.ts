import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { commands } from './definitions.js';
import { handleSettings, handleSettingsComponent, parseSettingsComponentId } from './settings.js';
import type { SettingsService } from '../services/settingsService.js';
import { panelIdentityRegistry } from '../discord/panelIdentity.js';

function settingsService() {
  const state = {
    defaultProvider: 'claude' as 'claude' | 'codex' | undefined,
    claudeModel: 'sonnet',
    codexModel: undefined as string | undefined,
    primaryAgentModel: undefined as string | undefined,
    claudeTimeoutMs: 900_000,
    usageReserve: 10,
  };
  const service = {
    global: vi.fn(() => ({ ...state })),
    project: vi.fn(),
    updateGlobal: vi.fn((input: Record<string, unknown>) => {
      Object.assign(state, input);
      return { ...state };
    }),
    updateGlobalWithActivation: vi.fn(async (input: Record<string, unknown>, activate: () => Promise<void>) => {
      Object.assign(state, input);
      await activate();
      return { ...state };
    }),
    updateProject: vi.fn(),
    resolveTaskSettings: vi.fn(),
    mcpProfiles: vi.fn(() => ({ profiles: ['default', 'browser'] as const })),
  } as unknown as SettingsService;
  return { service, state };
}

function commandInteraction(input: { channelId?: string; userId?: string; thread?: boolean } = {}) {
  return {
    channelId: input.channelId ?? 'primary-1',
    user: { id: input.userId ?? 'owner-1' },
    channel: { isThread: () => input.thread ?? false },
    reply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

function componentInteraction(input: Partial<{
  customId: string;
  channelId: string;
  userId: string;
  values: string[];
  modalValues: Record<string, string>;
  button: boolean;
  thread: boolean;
}> = {}) {
  const modalValues = input.modalValues ?? {};
  const customId = input.customId ?? 'settings:g:refresh';
  const channelId = input.channelId ?? 'primary-1';
  const userId = input.userId ?? 'owner-1';
  const message = {
    id: 'settings-panel',
    channelId,
    author: { id: 'bot-1', bot: true },
    components: [{ type: 1, components: [{ type: input.button ? 2 : 3, custom_id: customId }] }],
  };
  panelIdentityRegistry.register({ kind: 'settings', userId, channelId }, message, message.components);
  return {
    customId,
    channelId,
    user: { id: userId },
    channel: { isThread: () => input.thread ?? false },
    message,
    values: input.values ?? [],
    fields: { getTextInputValue: (id: string) => modalValues[id] ?? '' },
    isButton: () => input.button ?? false,
    isStringSelectMenu: () => Boolean(input.values),
    isModalSubmit: () => Boolean(input.modalValues),
    reply: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    showModal: vi.fn(async () => undefined),
  } as unknown as (ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) & {
    reply: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    showModal: ReturnType<typeof vi.fn>;
  };
}

describe('/settings', () => {
  it('is registered alongside the existing slash commands', () => {
    expect(commands.some(command => command.name === 'settings')).toBe(true);
    expect(commands.some(command => command.name === 'project-settings')).toBe(true);
  });

  it('requires the exact configured primary channel and owner', async () => {
    const { service } = settingsService();
    const interaction = commandInteraction({ channelId: 'channel-named-agent-chat', userId: 'owner-1' });

    await handleSettings(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/exact primary channel/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('does not expose project filesystem paths or host-only settings in the summary', async () => {
    const { service } = settingsService();
    const interaction = commandInteraction();

    await handleSettings(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ data?: { description?: string } }> };
    const description = payload.embeds?.[0]?.data?.description ?? '';
    expect(description).not.toContain('C:\\secret');
    expect(description).not.toMatch(/token|api.?key|sandbox|permission|working.?directory/i);
  });

  it('parses only bounded, known global component IDs', () => {
    expect(parseSettingsComponentId('settings:g:model:claude')).toEqual({ scope: 'global', action: 'model', provider: 'claude' });
    expect(parseSettingsComponentId('settings:g:model:other')).toBeUndefined();
    expect(parseSettingsComponentId('settings:g:unknown')).toBeUndefined();
    expect(parseSettingsComponentId('settings:g:model:claude:forged')).toBeUndefined();
    expect(parseSettingsComponentId('settings:g:provider:forged')).toBeUndefined();
  });

  it('filters unavailable providers and models from the global panel', async () => {
    const { service } = settingsService();
    const interaction = commandInteraction();
    const availability = vi.fn(async (provider: 'claude' | 'codex') => provider === 'claude'
      ? { available: true }
      : { available: false, authenticationRequired: true, reason: 'device-code-secret' });

    await handleSettings(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { description?: string } }>; components: Array<{ toJSON: () => { components?: Array<{ custom_id?: string; options?: Array<{ value?: string }> }> } }> };
    const components = payload.components.flatMap(row => row.toJSON().components ?? []);
    expect(components.find(component => component.custom_id === 'settings:g:provider')?.options?.map(option => option.value)).toEqual(['claude']);
    expect(components.some(component => component.custom_id === 'settings:g:model:codex')).toBe(false);
    expect(components.some(component => component.custom_id === 'settings:g:model-custom:codex')).toBe(false);
    expect(payload.embeds[0].toJSON().description).toMatch(/Codex status: \*\*unavailable \/ owner action required\*\*/i);
    expect(payload.embeds[0].toJSON().description).not.toMatch(/authentication required|device-code-secret/i);
    expect(availability).toHaveBeenCalledWith('codex');
  });

  it('marks a persisted but unregistered default provider unavailable and requiring owner action', async () => {
    const { service, state } = settingsService();
    state.defaultProvider = 'codex';
    const interaction = commandInteraction();

    await handleSettings(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { description?: string } }> };
    const description = payload.embeds[0].toJSON().description ?? '';
    expect(description).toMatch(/Default provider: \*\*Codex\*\*/i);
    expect(description).toMatch(/unavailable \/ owner action required/i);
    expect(description).not.toMatch(/not registered|authentication|reason|error/i);
  });

  it('keeps a long saved model editable and clearable through a bounded modal', async () => {
    const { service, state } = settingsService();
    state.codexModel = 'x'.repeat(101);
    const panelInteraction = commandInteraction();
    const available = { list: (): ('claude' | 'codex')[] => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) };

    await handleSettings(panelInteraction, {
      settings: service,
      providers: available,
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });
    const payload = panelInteraction.reply.mock.calls[0][0] as { components: Array<{ toJSON: () => { components?: Array<{ custom_id?: string; options?: Array<{ value?: string }> }> } }> };
    const components = payload.components.flatMap(row => row.toJSON().components ?? []);
    const codexMenu = components.find(component => component.custom_id === 'settings:g:model:codex');
    expect(codexMenu?.options?.some(option => option.value === 'x'.repeat(100))).toBe(false);

    const modalInteraction = componentInteraction({ customId: 'settings:g:model-custom:codex', button: true });
    await handleSettingsComponent(modalInteraction, {
      settings: service,
      providers: available,
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });
    const shown = modalInteraction.showModal.mock.calls[0][0].toJSON();
    expect(shown.components[0].components[0]).toMatchObject({ required: false, max_length: 100 });

    const clearInteraction = componentInteraction({
      customId: 'settings:g:model-custom:codex',
      modalValues: { model: '' },
    });
    await handleSettingsComponent(clearInteraction, {
      settings: service,
      providers: available,
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });
    expect(service.updateGlobal).toHaveBeenCalledWith({ codexModel: '' });
  });

  it('rejects forged, wrong-owner, wrong-channel, and thread component submissions', async () => {
    const make = (input: Partial<{ customId: string; userId: string; channelId: string; thread: boolean }>) => componentInteraction({
      customId: input.customId ?? 'settings:g:model:claude',
      userId: input.userId,
      channelId: input.channelId,
      thread: input.thread,
      values: ['sonnet'],
    });
    const cases = [
      make({ customId: 'settings:g:model:claude:forged' }),
      make({ userId: 'other-owner' }),
      make({ channelId: 'other-channel' }),
      make({ thread: true }),
    ];
    for (const interaction of cases) {
      const { service } = settingsService();
      await handleSettingsComponent(interaction, {
        settings: service,
        providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
        primaryChannelId: 'primary-1',
        primaryOwnerId: 'owner-1',
      });
      expect(service.updateGlobal).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    }
  });

  it('rejects a foreign bot message even when its settings component ID is valid', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:model:claude', values: ['sonnet'] });
    (interaction as unknown as { message: { id: string } }).message.id = 'another-bot-panel';

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(service.updateGlobal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/stale|unexpected controls/i) }));
  });

  it('rejects a settings message whose controls no longer match the tracked schema', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:model:claude', values: ['sonnet'] });
    (interaction as unknown as { message: { components: unknown[] } }).message.components = [{ type: 1, components: [{ type: 2, custom_id: 'settings:g:provider' }] }];

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(service.updateGlobal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/unexpected controls/i) }));
  });

  it('persists a validated timeout through the SettingsService from a modal', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({
      customId: 'settings:g:timeout',
      modalValues: { timeout_ms: '120000' },
    });
    (interaction as unknown as { isModalSubmit: () => boolean }).isModalSubmit = () => true;

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ claudeTimeoutMs: 120_000 });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('persists an active provider timeout without activating or rebuilding the PM', async () => {
    const { service, state } = settingsService();
    state.defaultProvider = 'claude';
    const activate = vi.fn(async () => 'reconfigured' as const);
    const interaction = componentInteraction({
      customId: 'settings:g:timeout',
      modalValues: { timeout_ms: '120000' },
    });
    (interaction as unknown as { isModalSubmit: () => boolean }).isModalSubmit = () => true;

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: activate,
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ claudeTimeoutMs: 120_000 });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.not.stringMatching(/PM (activated|reconfigured)/i),
    }));
  });

  it('rejects unsupported provider model selections before persistence', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({
      customId: 'settings:g:model:claude',
      values: ['gpt-5-codex'],
    });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(service.updateGlobal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/unsupported.*model/i) }));
  });

  it('reports that a global provider change reconfigured the PM', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:provider', values: ['codex'] });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: vi.fn(async () => 'reconfigured' as const),
    });

    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/PM reconfigured/i),
    }));
  });

  it('persists a provider model change without activating or rebuilding the PM', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:model:claude', values: ['opus'] });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: vi.fn(async () => 'reconfigured' as const),
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ claudeModel: 'opus' });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/saved for new tasks/i),
    }));
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.not.stringMatching(/PM (activated|reconfigured)/i),
    }));
  });

  it('persists an inactive-provider model without invoking or reporting PM reconfiguration', async () => {
    const { service, state } = settingsService();
    state.defaultProvider = 'codex';
    const activate = vi.fn(async () => { throw new Error('active PM activation must not run'); });
    const interaction = componentInteraction({ customId: 'settings:g:model:claude', values: ['opus'] });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: activate,
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ claudeModel: 'opus' });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/saved for new tasks/i),
    }));
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.not.stringMatching(/PM (activated|reconfigured)/i),
    }));
  });

  it('persists an unavailable provider model override when clearing it without PM activation', async () => {
    const { service, state } = settingsService();
    state.codexModel = 'stale-codex-model';
    const activate = vi.fn(async () => { throw new Error('PM activation must not run'); });
    const panelInteraction = commandInteraction();
    const unavailable = { list: (): ('claude' | 'codex')[] => ['claude', 'codex'], availability: vi.fn(async provider => provider === 'claude' ? { available: true } : { available: false }) };

    await handleSettings(panelInteraction, {
      settings: service,
      providers: unavailable,
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });
    const panel = panelInteraction.reply.mock.calls[0][0] as { components: Array<{ toJSON: () => { components?: Array<{ custom_id?: string }> } }> };
    expect(panel.components.flatMap(row => row.toJSON().components ?? []).some(component => component.custom_id === 'settings:g:model-clear:codex')).toBe(true);

    const interaction = componentInteraction({ customId: 'settings:g:model-clear:codex', button: true });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: unavailable,
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: activate,
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ codexModel: '' });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/saved for new tasks/i),
    }));
  });

  it('clears the global PM model override while its provider is unavailable', async () => {
    const { service, state } = settingsService();
    state.defaultProvider = 'codex';
    state.primaryAgentModel = 'stale-pm-model';
    const activate = vi.fn(async () => { throw new Error('PM activation must not run'); });
    const interaction = componentInteraction({ customId: 'settings:g:pm-model', modalValues: { model: '' } });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async provider => provider === 'claude' ? { available: true } : { available: false }) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: activate,
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ primaryAgentModel: '' });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('explains that a usage reserve affects future admissions while active reservations stay unchanged', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:reserve', modalValues: { reserve_percent: '20' } });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ usageReserve: 20 });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/future admissions and reservations.*later continuation turns.*active reservations remain unchanged/i),
    }));
  });

  it('reports that a PM model change reconfigured the PM', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:pm-model', modalValues: { model: 'pm-model' } });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: vi.fn(async () => 'reconfigured' as const),
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/PM reconfigured/i),
    }));
  });

  it('persists a PM model without activation until the owner selects a global provider', async () => {
    const { service, state } = settingsService();
    state.defaultProvider = undefined;
    const activate = vi.fn(async () => 'activated' as const);
    const interaction = componentInteraction({ customId: 'settings:g:pm-model', modalValues: { model: 'pm-model' } });

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: activate,
    });

    expect(service.updateGlobal).toHaveBeenCalledWith({ primaryAgentModel: 'pm-model' });
    expect(service.updateGlobalWithActivation).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/PM model saved.*remains inactive until you explicitly select a global provider/i),
    }));
  });

  it('reports PM reconfiguration failure and rollback without exposing the error', async () => {
    const { service } = settingsService();
    const interaction = componentInteraction({ customId: 'settings:g:provider', values: ['codex'] });
    service.updateGlobalWithActivation = vi.fn(async (_input: Record<string, unknown>, activate: () => Promise<void>) => {
      await activate();
      throw new Error('provider secret abc123 failed');
    }) as unknown as SettingsService['updateGlobalWithActivation'];

    await handleSettingsComponent(interaction, {
      settings: service,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      primaryChannelId: 'primary-1',
      primaryOwnerId: 'owner-1',
      activatePrimaryProvider: vi.fn(async () => { throw new Error('provider secret abc123 failed'); }),
    });

    const reply = interaction.reply.mock.calls[0][0] as { content?: string };
    expect(reply.content).toMatch(/PM reconfiguration failed/i);
    expect(reply.content).toMatch(/rolled back/i);
    expect(reply.content).not.toContain('abc123');
  });
});

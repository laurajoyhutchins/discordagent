import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { handleProjectSettings, handleProjectSettingsComponent, parseProjectSettingsComponentId, parseProjectModelSelection, projectSettingsComponentId } from './projectSettings.js';
import type { SettingsService } from '../services/settingsService.js';
import type { Project } from '../types.js';
import { panelIdentityRegistry } from '../discord/panelIdentity.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: 'C:\\secret\\factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'codex',
  models: { claude: 'sonnet', codex: 'gpt-5-codex' },
  reasoningEfforts: { codex: 'high' },
};

function service() {
  return {
    global: vi.fn(() => ({ defaultProvider: 'claude' as const })),
    project: vi.fn(() => ({
      defaultProvider: 'codex' as const,
      claudeModel: 'sonnet',
      codexModel: 'gpt-5-codex',
      reasoningEfforts: { codex: 'high' as const },
      baseBranch: 'main',
      mcpProfile: 'default',
      roborevEnabled: false,
    })),
    updateGlobal: vi.fn(),
    updateGlobalWithActivation: vi.fn(),
    updateProject: vi.fn(() => ({})),
    resolveTaskSettings: vi.fn(),
    mcpProfiles: vi.fn(() => ({ profiles: ['default', 'browser'] as const })),
  } as unknown as SettingsService;
}

function commandInteraction(input: { channelId?: string; thread?: boolean } = {}) {
  return {
    channelId: input.channelId ?? 'agent-1',
    user: { id: 'user-1' },
    channel: { isThread: () => input.thread ?? false },
    guild: { members: { fetch: vi.fn(async () => ({ id: 'user-1' })) } },
    reply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

function selectInteraction(value: string) {
  const customId = projectSettingsComponentId('agent-1', 'factory-floor', 'model');
  const message = {
    id: 'project-settings-panel',
    channelId: 'agent-1',
    author: { id: 'bot-1', bot: true },
    components: [{ type: 1, components: [{ type: 3, custom_id: customId }] }],
  };
  panelIdentityRegistry.register({ kind: 'project-settings', userId: 'user-1', channelId: 'agent-1' }, message, message.components);
  return {
    customId,
    channelId: 'agent-1',
    user: { id: 'user-1' },
    channel: { isThread: () => false },
    message,
    guild: { members: { fetch: vi.fn(async () => ({ id: 'user-1' })) } },
    values: [value],
    isStringSelectMenu: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    update: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  } as unknown as StringSelectMenuInteraction & { update: ReturnType<typeof vi.fn>; reply: ReturnType<typeof vi.fn> };
}

describe('/project-settings', () => {
  it('requires an authorized project channel and rejects task threads', async () => {
    const interaction = commandInteraction({ thread: true });
    await handleProjectSettings(interaction, {
      settings: service(),
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/task thread/i),
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('rejects a project channel when the member lacks the existing authorized role', async () => {
    const interaction = commandInteraction();
    await handleProjectSettings(interaction, {
      settings: service(),
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => false,
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/not authorized/i) }));
  });

  it('keeps project model selections provider-scoped', () => {
    const id = projectSettingsComponentId('agent-1', 'factory-floor', 'model');
    expect(parseProjectSettingsComponentId(id)).toMatchObject({ scope: 'project', channelId: 'agent-1', action: 'model' });
    expect(parseProjectSettingsComponentId('settings:p:agent-1:model')).toBeUndefined();
    expect(parseProjectModelSelection('codex|gpt-5-codex')).toEqual({ provider: 'codex', model: 'gpt-5-codex' });
    expect(parseProjectModelSelection('claude|gpt-5-codex')).toEqual({ provider: 'claude', model: 'gpt-5-codex' });
  });

  it('persists an authorized provider-scoped project model through SettingsService', async () => {
    const settings = service();
    const interaction = selectInteraction('codex|gpt-5-codex-mini');

    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).toHaveBeenCalledWith('factory-floor', { codexModel: 'gpt-5-codex-mini' });
    expect(interaction.update).toHaveBeenCalled();
  });

  it('does not expose the project working directory in the rendered panel', async () => {
    const interaction = commandInteraction();
    await handleProjectSettings(interaction, {
      settings: service(),
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ data?: { description?: string } }> };
    expect(payload.embeds?.[0]?.data?.description ?? '').not.toContain('C:\\secret\\factory-floor');
  });

  it('resolves the effective provider through project, global, and live availability', async () => {
    const settings = service();
    settings.project = vi.fn(() => ({
      defaultProvider: undefined,
      claudeModel: 'sonnet',
      codexModel: 'gpt-5-codex',
    }));
    settings.global = vi.fn(() => ({ defaultProvider: 'codex' as const }));
    const interaction = commandInteraction();
    const availability = vi.fn(async (provider: 'claude' | 'codex') => provider === 'claude'
      ? { available: true }
      : { available: false, authenticationRequired: true });

    await handleProjectSettings(interaction, {
      settings,
      providers: { list: () => ['claude', 'codex'], availability },
      getProjectByChannel: () => ({ ...project, defaultProvider: undefined } as unknown as Project),
      isAuthorizedMember: () => true,
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ data?: { description?: string } }>; components: Array<{ toJSON: () => { components?: Array<{ options?: Array<{ value?: string }> }> } }> };
    expect(payload.embeds[0].data?.description).toMatch(/Effective provider: \*\*Codex \(unavailable/i);
    const values = payload.components.flatMap(row => row.toJSON().components ?? [])
      .flatMap(component => component.options ?? []).map(option => option.value);
    expect(values.some(value => value?.startsWith('codex|'))).toBe(false);
    expect(availability).toHaveBeenCalledWith('codex');
  });

  it('does not replace an unavailable persisted provider with the first live provider', async () => {
    const settings = service();
    const interaction = commandInteraction();
    const availability = vi.fn(async (provider: 'claude' | 'codex') => provider === 'claude'
      ? { available: true }
      : { available: false, authenticationRequired: true, reason: 'Codex authentication is required' });

    await handleProjectSettings(interaction, {
      settings,
      providers: { list: () => ['claude', 'codex'], availability },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    const payload = interaction.reply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
      components: Array<{ toJSON: () => { components?: Array<{ custom_id?: string; disabled?: boolean }> } }>;
    };
    const components = payload.components.flatMap(row => row.toJSON().components ?? []);
    const modelMenu = components.find(component => component.custom_id?.endsWith(':model'));
    const description = payload.embeds[0].toJSON().description ?? '';
    expect(description).toContain('Effective provider: **Codex (unavailable / owner action required)**');
    expect(description).not.toMatch(/authentication required|Codex authentication is required|registration|not registered|provider error details/i);
    expect(payload.embeds[0].toJSON().description).not.toMatch(/Effective provider: \*\*Claude/i);
    expect(modelMenu?.disabled).toBe(true);
  });

  it('normalizes an unregistered configured provider to the safe owner-action status', async () => {
    const interaction = commandInteraction();

    await handleProjectSettings(interaction, {
      settings: service(),
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    const payload = interaction.reply.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { description?: string } }> };
    const description = payload.embeds[0].toJSON().description ?? '';
    expect(description).toContain('Effective provider: **Codex (unavailable / owner action required)**');
    expect(description).not.toMatch(/authentication required|not registered|registration|error/i);
  });

  it('exposes a clear action for an unavailable project model override', async () => {
    const settings = service();
    settings.project = vi.fn(() => ({
      defaultProvider: 'codex' as const,
      claudeModel: undefined,
      codexModel: 'stale-codex-model',
      reasoningEfforts: { codex: 'high' as const },
      baseBranch: 'main',
      mcpProfile: 'default',
    }));
    const unavailable = { list: (): ('claude' | 'codex')[] => ['claude', 'codex'], availability: vi.fn(async provider => provider === 'claude' ? { available: true } : { available: false }) };
    const panelInteraction = commandInteraction();
    await handleProjectSettings(panelInteraction, {
      settings,
      providers: unavailable,
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });
    const panel = panelInteraction.reply.mock.calls[0][0] as { components: Array<{ toJSON: () => { components?: Array<{ options?: Array<{ value?: string }> }> } }> };
    expect(panel.components.flatMap(row => row.toJSON().components ?? [])
      .flatMap(component => component.options ?? [])
      .some(option => option.value === 'clear|codex')).toBe(true);

    const interaction = {
      customId: projectSettingsComponentId('agent-1', 'factory-floor', 'action'),
      channelId: 'agent-1',
      user: { id: 'user-1' },
      channel: { isThread: () => false },
      message: {
        id: 'project-settings-panel',
        channelId: 'agent-1',
        author: { id: 'bot-1', bot: true },
        components: [{ type: 1, components: [{ type: 3, custom_id: projectSettingsComponentId('agent-1', 'factory-floor', 'action') }] }],
      },
      guild: { members: { fetch: vi.fn(async () => ({ id: 'user-1' })) } },
      values: ['clear|codex'],
      isStringSelectMenu: () => true,
      isModalSubmit: () => false,
      update: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    } as unknown as StringSelectMenuInteraction & { update: ReturnType<typeof vi.fn>; reply: ReturnType<typeof vi.fn> };
    const message = (interaction as unknown as { message: { id: string; channelId: string; author: { id: string; bot: boolean }; components: unknown[] } }).message;
    panelIdentityRegistry.register({ kind: 'project-settings', userId: 'user-1', channelId: 'agent-1' }, message, message.components);

    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: unavailable,
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).toHaveBeenCalledWith('factory-floor', { codexModel: '' });
    expect(interaction.update).toHaveBeenCalled();
  });

  it('rejects unavailable provider selections before the SettingsService write', async () => {
    const settings = service();
    const interaction = selectInteraction('codex|gpt-5-codex-mini');
    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async (provider: 'claude' | 'codex') => provider === 'claude' ? { available: true } : { available: false }) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/not available/i) }));
  });

  it('rechecks role, channel, and thread authorization for component submissions', async () => {
    const cases = [
      { authorized: false, channelId: 'agent-1', thread: false },
      { authorized: true, channelId: 'other-channel', thread: false },
      { authorized: true, channelId: 'agent-1', thread: true },
    ];
    for (const input of cases) {
      const settings = service();
      const interaction = selectInteraction('claude|sonnet');
      interaction.channelId = input.channelId;
      (interaction as unknown as { channel: { isThread: () => boolean } }).channel = { isThread: () => input.thread };
      await handleProjectSettingsComponent(interaction, {
        settings,
        providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
        getProjectByChannel: () => project,
        isAuthorizedMember: () => input.authorized,
      });
      expect(settings.updateProject).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/stale|authorized/i) }));
    }
  });

  it('rejects a component after its project is deleted or replaced on the same channel', async () => {
    const settings = service();
    const interaction = selectInteraction('claude|sonnet');
    interaction.customId = projectSettingsComponentId('agent-1', 'factory-floor', 'model');
    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => ({ ...project, name: 'replacement-project' }),
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/stale/i) }));
  });

  it('rejects a project settings component from a stale or foreign message', async () => {
    const settings = service();
    const interaction = selectInteraction('claude|sonnet');
    (interaction as unknown as { message: { author: { bot: boolean } } }).message.author.bot = false;

    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: { list: () => ['claude'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/stale|unexpected controls/i) }));
  });

  it('accepts an empty custom-model modal to clear the provider override', async () => {
    const settings = service();
    const interaction = {
      customId: projectSettingsComponentId('agent-1', 'factory-floor', 'model-custom:codex'),
      channelId: 'agent-1',
      user: { id: 'user-1' },
      channel: { isThread: () => false },
      message: {
        id: 'project-settings-panel',
        channelId: 'agent-1',
        author: { id: 'bot-1', bot: true },
        components: [{ type: 1, components: [{ type: 3, custom_id: projectSettingsComponentId('agent-1', 'factory-floor', 'model-custom:codex') }] }],
      },
      guild: { members: { fetch: vi.fn(async () => ({ id: 'user-1' })) } },
      fields: { getTextInputValue: () => '' },
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      reply: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof handleProjectSettingsComponent>[0] & { reply: ReturnType<typeof vi.fn> };
    const message = (interaction as unknown as { message: { id: string; channelId: string; author: { id: string; bot: boolean }; components: unknown[] } }).message;
    panelIdentityRegistry.register({ kind: 'project-settings', userId: 'user-1', channelId: 'agent-1' }, message, message.components);

    await handleProjectSettingsComponent(interaction, {
      settings,
      providers: { list: () => ['claude', 'codex'], availability: vi.fn(async () => ({ available: true })) },
      getProjectByChannel: () => project,
      isAuthorizedMember: () => true,
    });

    expect(settings.updateProject).toHaveBeenCalledWith('factory-floor', { codexModel: '' });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
});

import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createHash } from 'node:crypto';
import { REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { Project } from '../types.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { getProviderRegistry, getSettingsService } from '../services/agentRuntimeService.js';
import type { SettingsService } from '../services/settingsService.js';
import {
  fetchInteractionMember,
  isThreadChannel,
  modelChoices,
  providerId,
  settingError,
  validateModelSelection,
  type SettingsCommandDependencies,
} from './settings.js';
import { isAuthorized } from '../utils/permissions.js';
import { MAX_MODEL_OVERRIDE_LENGTH, validateModelOverride } from '../settings/validation.js';
import { panelIdentityRegistry, type PanelIdentityKey, type PanelIdentityRegistry } from '../discord/panelIdentity.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface ProjectSettingsCommandDependencies extends Pick<SettingsCommandDependencies, 'settings' | 'providers'> {
  getProjectByChannel(channelId: string): Project | undefined;
  isAuthorizedMember(member: unknown): boolean | Promise<boolean>;
  panelIdentity?: PanelIdentityRegistry;
}

type ProjectComponent =
  | { scope: 'project'; channelId: string; projectToken: string; action: 'provider' | 'model' | 'reasoning' | 'mcp' | 'action' }
  | { scope: 'project'; channelId: string; projectToken: string; action: 'model-custom'; provider: AgentProviderId }
  | { scope: 'project'; channelId: string; projectToken: string; action: 'base-branch' };

function defaultDependencies(): ProjectSettingsCommandDependencies {
  return {
    settings: getSettingsService(),
    providers: getProviderRegistry(),
    getProjectByChannel,
    isAuthorizedMember: member => isAuthorized(member as Parameters<typeof isAuthorized>[0]),
    panelIdentity: panelIdentityRegistry,
  };
}

function projectPanelKey(interaction: { user: { id: string }; channelId: string | null }): PanelIdentityKey {
  return { kind: 'project-settings', userId: interaction.user.id, channelId: interaction.channelId ?? '' };
}

function registerPanelReply(
  dependencies: ProjectSettingsCommandDependencies,
  key: PanelIdentityKey,
  result: unknown,
  components: readonly unknown[],
): void {
  (dependencies.panelIdentity ?? panelIdentityRegistry).register(key, result as { id?: unknown; channelId?: unknown; author?: { id?: unknown; bot?: unknown } | null }, components);
}

function projectToken(projectName: string): string {
  return createHash('sha256').update(projectName).digest('hex').slice(0, 12);
}

export function projectSettingsComponentId(channelId: string, projectName: string, action: string): string {
  const id = `settings:p:${channelId}:${projectToken(projectName)}:${action}`;
  if (id.length > 100) throw new Error('Project settings component ID is too long.');
  return id;
}

export function parseProjectSettingsComponentId(customId: string): ProjectComponent | undefined {
  const parts = customId.split(':');
  if (parts[0] !== 'settings' || parts[1] !== 'p' || !parts[2] || !parts[3]) return undefined;
  const channelId = parts[2];
  const projectToken = parts[3];
  if (parts[4] === 'provider' || parts[4] === 'model' || parts[4] === 'reasoning' || parts[4] === 'mcp' || parts[4] === 'action') {
    if (parts.length !== 5) return undefined;
    return { scope: 'project', channelId, projectToken, action: parts[4] };
  }
  if (parts[4] === 'model-custom' && parts.length === 6) {
    const provider = providerId(parts[5]);
    return provider ? { scope: 'project', channelId, projectToken, action: 'model-custom', provider } : undefined;
  }
  if (parts[4] === 'base-branch' && parts.length === 5) return { scope: 'project', channelId, projectToken, action: 'base-branch' };
  return undefined;
}

export function parseProjectModelSelection(value: string): { provider: AgentProviderId; model: string } | undefined {
  const separator = value.indexOf('|');
  if (separator <= 0) return undefined;
  const provider = providerId(value.slice(0, separator));
  const model = value.slice(separator + 1);
  if (!provider || !model) return undefined;
  return { provider, model };
}

function providerLabel(provider: AgentProviderId): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function currentModel(settings: ReturnType<SettingsService['project']>, provider: AgentProviderId): string | undefined {
  return provider === 'claude' ? settings.claudeModel : settings.codexModel;
}

function modelMenu(channelId: string, projectName: string, settings: ReturnType<SettingsService['project']>, providers: readonly AgentProviderId[], selectedProvider?: AgentProviderId): StringSelectMenuBuilder {
  const options = [
    ...providers.flatMap(provider => [
      new StringSelectMenuOptionBuilder().setLabel(`${providerLabel(provider)}: provider default`).setValue(`${provider}|__default__`).setDescription(`Clear the ${providerLabel(provider)} project override`),
      ...modelChoices(provider, currentModel(settings, provider), MAX_MODEL_OVERRIDE_LENGTH - provider.length - 1).map(model => new StringSelectMenuOptionBuilder()
        .setLabel(`${providerLabel(provider)}: ${model}`).setValue(`${provider}|${model}`).setDescription(`${providerLabel(provider)} project model`)),
    ]),
  ];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(projectSettingsComponentId(channelId, projectName, 'model'))
    .setPlaceholder('Project provider-scoped model')
    .addOptions(options);
  const selected = selectedProvider ?? settings.defaultProvider;
  if (!selected) return menu;
  const selectedModel = currentModel(settings, selected);
  const selectedValue = `${selected}|${selectedModel ?? '__default__'}`;
  for (const option of menu.options) {
    if (option.data.value === selectedValue) option.setDefault(true);
  }
  return menu;
}

function simpleMenu(customId: string, placeholder: string, options: StringSelectMenuOptionBuilder[]): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options);
}

async function projectPanel(
  dependencies: ProjectSettingsCommandDependencies,
  project: Project,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] }> {
  const current = dependencies.settings.project(project.name);
  const global = dependencies.settings.global();
  const providerStates = await Promise.all(dependencies.providers.list().map(async provider => {
    try {
      return { provider, availability: await dependencies.providers.availability(provider) };
    } catch {
      return { provider, availability: { available: false } };
    }
  }));
  const providers = providerStates.filter(state => state.availability.available).map(state => state.provider);
  const configuredProvider = current.defaultProvider ?? global.defaultProvider;
  const currentProvider = configuredProvider && providers.includes(configuredProvider) ? configuredProvider : undefined;
  const effectiveProvider = currentProvider
    ? providerLabel(currentProvider)
    : configuredProvider
      ? `${providerLabel(configuredProvider)} (unavailable / owner action required)`
      : 'blocked (no provider configured)';
  const providerDependentControlsDisabled = currentProvider === undefined;
  const providerOptions = providers.map(provider => new StringSelectMenuOptionBuilder()
    .setLabel(providerLabel(provider)).setValue(provider).setDescription(`Use ${providerLabel(provider)} for new tasks`));
  const reasoningOptions = [
    new StringSelectMenuOptionBuilder().setLabel('Provider/model default').setValue('__default__').setDescription('Use the Codex default'),
    ...REASONING_EFFORTS.map(effort => new StringSelectMenuOptionBuilder().setLabel(effort).setValue(effort).setDescription('Codex reasoning effort')),
  ];
  const mcpOptions = [
    new StringSelectMenuOptionBuilder().setLabel('No MCP profile').setValue('__default__').setDescription('Use no selected profile'),
    ...dependencies.settings.mcpProfiles().profiles.map(profile => new StringSelectMenuOptionBuilder().setLabel(profile.slice(0, 100)).setValue(profile.slice(0, 100)).setDescription('Host-allowlisted MCP profile')),
  ];
  const actionOptions = [
    ...(providerDependentControlsDisabled ? [] : providers.map(provider => new StringSelectMenuOptionBuilder().setLabel(`Custom ${providerLabel(provider)} model`).setValue(`custom|${provider}`).setDescription('Enter an exact provider-supported model ID'))),
    ...(['claude', 'codex'] as const)
      .filter(provider => Boolean(currentModel(current, provider)))
      .map(provider => new StringSelectMenuOptionBuilder()
        .setLabel(`Clear ${providerLabel(provider)} model override`)
        .setValue(`clear|${provider}`)
        .setDescription(`Remove the stored ${providerLabel(provider)} project model override`)),
    new StringSelectMenuOptionBuilder().setLabel('Edit base branch').setValue('base-branch').setDescription('Set the branch used by future worktrees'),
    new StringSelectMenuOptionBuilder().setLabel('Refresh').setValue('refresh').setDescription('Reload current settings'),
  ];
  const providerControl = simpleMenu(projectSettingsComponentId(project.agentChannelId, project.name, 'provider'), 'Project default provider', providerOptions);
  const modelControl = modelMenu(project.agentChannelId, project.name, current, providers, currentProvider).setDisabled(providerDependentControlsDisabled);
  const reasoningControl = simpleMenu(projectSettingsComponentId(project.agentChannelId, project.name, 'reasoning'), 'Codex reasoning effort', reasoningOptions).setDisabled(providerDependentControlsDisabled);
  const mcpControl = simpleMenu(projectSettingsComponentId(project.agentChannelId, project.name, 'mcp'), 'MCP profile', mcpOptions).setDisabled(providerDependentControlsDisabled);
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Project settings · ${project.name}`)
      .setDescription([
        `Effective provider: **${effectiveProvider}**`,
        `Configured provider: **${configuredProvider ? providerLabel(configuredProvider) : 'global/host default'}**`,
        `Claude model: \`${current.claudeModel ?? 'provider default'}\``,
        `Codex model: \`${current.codexModel ?? 'provider default'}\``,
        `Codex reasoning: **${current.reasoningEfforts?.codex ?? 'provider/model default'}**`,
        `Base branch: **${current.baseBranch ?? 'repository default'}**`,
        `MCP profile: **${current.mcpProfile ?? 'none'}**`,
        `Roborev: **${project.roborevChannelId ? 'enabled' : 'disabled'}**`,
        '',
        'Changes apply to new tasks. Existing task threads keep their provider, session, worktree, and settings snapshot.',
      ].join('\n'))],
    components: [
      ...(providers.length > 0 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerControl)] : []),
      ...(providers.length > 0 ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelControl)] : []),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(reasoningControl),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mcpControl),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(simpleMenu(projectSettingsComponentId(project.agentChannelId, project.name, 'action'), 'More project settings', actionOptions)),
    ],
  };
}

function modal(customId: string, title: string, inputId: string, label: string, value?: string, placeholder?: string, options: { required?: boolean; maxLength?: number } = {}): ModalBuilder {
  const input = new TextInputBuilder().setCustomId(inputId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(options.required ?? true);
  if (options.maxLength !== undefined) input.setMaxLength(options.maxLength);
  if (value !== undefined && (options.maxLength === undefined || value.length <= options.maxLength)) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ModalBuilder().setCustomId(customId).setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function ensureAvailable(dependencies: ProjectSettingsCommandDependencies, provider: AgentProviderId): Promise<void> {
  if (!dependencies.providers.list().includes(provider)) throw new Error(`Provider ${provider} is not available on this host.`);
  const availability = await dependencies.providers.availability(provider);
  if (!availability.available) throw new Error(`Provider ${provider} is not available on this host.`);
}

function replyEphemeral(interaction: { reply: (...args: any[]) => Promise<any> }, content: string): Promise<unknown> {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function authorizedProject(
  interaction: { channelId: string; guild?: { members?: { fetch: (id: string) => Promise<unknown> } } | null; user: { id: string }; channel?: unknown },
  dependencies: ProjectSettingsCommandDependencies,
): Promise<Project | undefined> {
  if (isThreadChannel(interaction) || !dependencies.getProjectByChannel(interaction.channelId)) return undefined;
  const project = dependencies.getProjectByChannel(interaction.channelId);
  if (!project || project.agentChannelId !== interaction.channelId) return undefined;
  const member = await fetchInteractionMember(interaction);
  if (!member || !(await dependencies.isAuthorizedMember(member))) return undefined;
  return project;
}

export async function handleProjectSettings(
  interaction: ChatInputCommandInteraction,
  injected?: ProjectSettingsCommandDependencies,
): Promise<void> {
  const dependencies = injected ?? defaultDependencies();
  if (isThreadChannel(interaction)) {
    await replyEphemeral(interaction, 'Project settings can only be changed in the main project channel, not a task thread.');
    return;
  }
  const project = await authorizedProject(interaction, dependencies);
  if (!project) {
    const channelProject = dependencies.getProjectByChannel(interaction.channelId);
    const member = await fetchInteractionMember(interaction);
    const authorized = member ? await dependencies.isAuthorizedMember(member) : false;
    await replyEphemeral(interaction, !authorized
      ? 'You are not authorized to manage project settings.'
      : channelProject
        ? 'Use `/project-settings` only in the main project channel.'
        : 'This command can only be used in a registered project channel.');
    return;
  }
  const panel = await projectPanel(dependencies, project);
  const result = await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral, fetchReply: true });
  registerPanelReply(dependencies, projectPanelKey(interaction), result, panel.components);
}

export async function handleProjectSettingsComponent(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  injected?: ProjectSettingsCommandDependencies,
): Promise<boolean> {
  if (!interaction.customId.startsWith('settings:p:')) return false;
  const dependencies = injected ?? defaultDependencies();
  const parsed = parseProjectSettingsComponentId(interaction.customId);
  const project = parsed && parsed.channelId === interaction.channelId
    ? dependencies.getProjectByChannel(interaction.channelId)
    : undefined;
  const member = project ? await fetchInteractionMember(interaction) : null;
  const authorized = member ? await dependencies.isAuthorizedMember(member) : false;
  if (!parsed || !project || parsed.projectToken !== projectToken(project.name) || project.agentChannelId !== interaction.channelId || !authorized || isThreadChannel(interaction)) {
    await replyEphemeral(interaction, 'This project settings panel is stale, outside the project channel, or not authorized.');
    return true;
  }
  const panelIdentity = dependencies.panelIdentity ?? panelIdentityRegistry;
  const panelKey = projectPanelKey(interaction);
  if (!panelIdentity.matches(panelKey, interaction.message)) {
    await replyEphemeral(interaction, 'This project settings panel is stale or has unexpected controls. Open `/project-settings` again.');
    return true;
  }

  try {
    const current = dependencies.settings.project(project.name);
    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];
      if (!value) throw new Error('A setting value is required.');
      if (parsed.action === 'provider') {
        const provider = providerId(value);
        if (!provider) throw new Error('Unsupported provider selection.');
        await ensureAvailable(dependencies, provider);
        dependencies.settings.updateProject(project.name, { defaultProvider: provider });
      } else if (parsed.action === 'model') {
        const selection = parseProjectModelSelection(value);
        if (!selection) throw new Error('Unsupported provider-scoped model selection.');
        await ensureAvailable(dependencies, selection.provider);
        const model = validateModelSelection(selection.model, selection.provider, currentModel(current, selection.provider));
        dependencies.settings.updateProject(project.name, selection.provider === 'claude' ? { claudeModel: model } : { codexModel: model });
      } else if (parsed.action === 'reasoning') {
        if (value !== '__default__' && !REASONING_EFFORTS.includes(value as ReasoningEffort)) throw new Error('Unsupported Codex reasoning effort.');
        dependencies.settings.updateProject(project.name, { reasoningEfforts: { codex: value === '__default__' ? undefined : value as ReasoningEffort } });
      } else if (parsed.action === 'mcp') {
        const profile = value === '__default__' ? null : value;
        if (profile !== null && !dependencies.settings.mcpProfiles().profiles.includes(profile)) {
          throw new Error('Unknown MCP profile selection.');
        }
        dependencies.settings.updateProject(project.name, { mcpProfile: profile });
      } else if (parsed.action === 'action') {
        if (value === 'refresh') {
          const panel = await projectPanel(dependencies, project);
          await interaction.update({ ...panel, content: undefined });
          registerPanelReply(dependencies, panelKey, interaction.message, panel.components);
          return true;
        }
        if (value === 'base-branch') {
          await interaction.showModal(modal(projectSettingsComponentId(project.agentChannelId, project.name, 'base-branch'), 'Base branch', 'base_branch', 'Branch name', current.baseBranch, 'main'));
          return true;
        }
        const clearProvider = value.startsWith('clear|') ? providerId(value.slice('clear|'.length)) : undefined;
        if (clearProvider) {
          dependencies.settings.updateProject(project.name, clearProvider === 'claude' ? { claudeModel: '' } : { codexModel: '' });
          const panel = await projectPanel(dependencies, project);
          await interaction.update({ ...panel, content: 'Project model override cleared. The refreshed value applies to new tasks.' });
          registerPanelReply(dependencies, panelKey, interaction.message, panel.components);
          return true;
        }
        const customProvider = value.startsWith('custom|') ? providerId(value.slice('custom|'.length)) : undefined;
        if (!customProvider) throw new Error('Unsupported project settings action.');
        await ensureAvailable(dependencies, customProvider);
        await interaction.showModal(modal(projectSettingsComponentId(project.agentChannelId, project.name, `model-custom:${customProvider}`), `Custom ${providerLabel(customProvider)} model`, 'model', 'Exact model ID', undefined, 'provider-supported model ID', { required: false, maxLength: MAX_MODEL_OVERRIDE_LENGTH }));
        return true;
      } else {
        throw new Error('Unsupported project settings selection.');
      }
      const panel = await projectPanel(dependencies, project);
      await interaction.update({ ...panel, content: 'Project setting saved. The refreshed value applies to new tasks.' });
      registerPanelReply(dependencies, panelKey, interaction.message, panel.components);
      return true;
    }

    if (interaction.isModalSubmit()) {
      if (parsed.action === 'model-custom' && parsed.provider) {
        const model = validateModelOverride(interaction.fields.getTextInputValue('model'));
        await ensureAvailable(dependencies, parsed.provider);
        dependencies.settings.updateProject(project.name, parsed.provider === 'claude' ? { claudeModel: model ?? '' } : { codexModel: model ?? '' });
      } else if (parsed.action === 'base-branch') {
        const branch = interaction.fields.getTextInputValue('base_branch').trim();
        if (!branch) throw new Error('Base branch must be a non-empty string.');
        dependencies.settings.updateProject(project.name, { baseBranch: branch });
      } else {
        throw new Error('Unsupported project settings modal.');
      }
      const panel = await projectPanel(dependencies, project);
      const result = await interaction.reply({
        ...panel,
        content: 'Project setting saved. It applies to new tasks; existing task threads remain unchanged.',
        flags: MessageFlags.Ephemeral, fetchReply: true,
      });
      registerPanelReply(dependencies, panelKey, result, panel.components);
      return true;
    }
  } catch (error) {
    console.error('[project-settings] Settings component failed:', redactErrorMessage(error));
    await replyEphemeral(interaction, settingError(error));
    return true;
  }
  return true;
}

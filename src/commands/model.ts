import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';
import type { Project } from '../types.js';
import {
  getDefaultModel,
  getDefaultProvider,
  getDefaultReasoning,
  getProjectByChannel,
  updateDefaultModel,
  updateDefaultReasoning,
  updateProjectModel,
  updateProjectReasoning,
} from '../services/projectStore.js';
import { activatePrimaryProvider } from '../services/agentRuntimeService.js';

interface ModelOption {
  label: string;
  value: string;
  description: string;
  emoji?: string;
}

const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { label: 'Claude Sonnet', value: 'sonnet', description: 'Balanced speed and capability', emoji: '⚡' },
  { label: 'Claude Opus', value: 'opus', description: 'Most powerful reasoning', emoji: '🧠' },
  { label: 'Claude Haiku', value: 'haiku', description: 'Fastest lightweight tasks', emoji: '🪶' },
  { label: 'Default', value: '__default__', description: 'Use CLAUDE_MODEL or the provider default', emoji: '🔄' },
];

export interface ModelCommandDependencies {
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectModel(name: string, model: string, provider?: AgentProviderId): void;
  updateProjectReasoning(name: string, effort?: ReasoningEffort, provider?: AgentProviderId): void;
  getDefaultProvider?(): AgentProviderId | undefined;
  getDefaultModel?(provider: AgentProviderId): string | undefined;
  getDefaultReasoning?(provider: AgentProviderId): ReasoningEffort | undefined;
  updateDefaultModel?(model: string, provider: AgentProviderId): void;
  updateDefaultReasoning?(effort: ReasoningEffort | undefined, provider: AgentProviderId): void;
  activateDefaultProvider?(provider: AgentProviderId): Promise<void>;
  defaultClaudeModel: string;
  defaultCodexModel?: string;
}

function defaultDependencies(): ModelCommandDependencies {
  return {
    getProjectByChannel,
    updateProjectModel,
    updateProjectReasoning,
    getDefaultProvider,
    getDefaultModel,
    getDefaultReasoning,
    updateDefaultModel,
    updateDefaultReasoning,
    activateDefaultProvider: activatePrimaryProvider,
    defaultClaudeModel: process.env.CLAUDE_MODEL ?? '',
    defaultCodexModel: process.env.CODEX_MODEL ?? '',
  };
}

export async function handleModel(
  interaction: ChatInputCommandInteraction,
  injected?: ModelCommandDependencies,
): Promise<void> {
  const dependencies = injected ?? defaultDependencies();
  if (interaction.channel?.isThread()) {
    await interaction.reply({
      content: 'A task thread keeps its current provider/model context. Change the project model from the main project channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pickedModel = interaction.options.getString('model');
  const customValue = interaction.options.getString('custom');
  const thinkingValue = interaction.options.getString('thinking');
  const directValue = pickedModel || customValue;

  const project = dependencies.getProjectByChannel(interaction.channelId);
  const channelName = interaction.channel && 'name' in interaction.channel ? interaction.channel.name : undefined;
  if (!project && channelName === 'agent-chat') {
    const provider = dependencies.getDefaultProvider?.();
    if (!provider) {
      await interaction.reply({ content: 'No global provider is selected yet. Choose one in the setup prompt first.', flags: MessageFlags.Ephemeral });
      return;
    }
    const currentModel = dependencies.getDefaultModel?.(provider)
      || (provider === 'claude' ? dependencies.defaultClaudeModel : dependencies.defaultCodexModel)
      || 'provider default';
    const currentReasoning = dependencies.getDefaultReasoning?.(provider) || 'provider/model default';
    if (thinkingValue && provider !== 'codex') {
      await interaction.reply({ content: 'Thinking depth is currently available for the Codex PM. Claude keeps its provider-managed thinking behavior.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (thinkingValue && thinkingValue !== '__default__'
      && !REASONING_EFFORTS.includes(thinkingValue as ReasoningEffort)) {
      await interaction.reply({ content: `Unknown thinking depth: \`${thinkingValue}\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (directValue || thinkingValue) {
      const modelToSet = directValue ? (directValue === '__default__' ? '' : directValue) : undefined;
      const reasoningToSet = thinkingValue && thinkingValue !== '__default__'
        ? thinkingValue as ReasoningEffort
        : undefined;
      const setDefaultModel = dependencies.updateDefaultModel;
      const setDefaultReasoning = dependencies.updateDefaultReasoning;
      const activateProvider = dependencies.activateDefaultProvider;
      if ((directValue && !setDefaultModel)
        || (thinkingValue && !setDefaultReasoning)
        || !activateProvider) {
        await interaction.reply({ content: 'Global model settings are unavailable until the runtime is fully initialized.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (directValue) setDefaultModel!(modelToSet ?? '', provider);
      if (thinkingValue) setDefaultReasoning!(reasoningToSet, provider);
      await activateProvider!(provider);
      const changes = [
        directValue ? `model set to \`${modelToSet || 'provider default'}\`` : undefined,
        thinkingValue ? `thinking depth set to \`${reasoningToSet || 'provider/model default'}\`` : undefined,
      ].filter((value): value is string => Boolean(value));
      await interaction.reply({
        content: `Global ${provider} PM settings updated: ${changes.join('; ')}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: `Global ${provider} PM model: \`${currentModel}\`. Thinking depth: \`${currentReasoning}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!project || interaction.channelId !== project.agentChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project channel or #agent-chat.', flags: MessageFlags.Ephemeral });
    return;
  }

  const provider = project.defaultProvider;
  const currentReasoning = project.reasoningEfforts?.[provider] || 'provider/model default';

  if (thinkingValue && provider !== 'codex') {
    await interaction.reply({
      content: 'Thinking depth is currently available for Codex task projects. Claude keeps its provider-managed thinking behavior.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (thinkingValue && thinkingValue !== '__default__'
    && !REASONING_EFFORTS.includes(thinkingValue as ReasoningEffort)) {
    await interaction.reply({ content: `Unknown thinking depth: \`${thinkingValue}\`.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const currentModel = project.models?.[provider]
    || (provider === 'claude' ? dependencies.defaultClaudeModel : '')
    || 'provider default';

  if (directValue || thinkingValue) {
    const modelToSet = directValue ? (directValue === '__default__' ? '' : directValue) : undefined;
    const reasoningToSet = thinkingValue && thinkingValue !== '__default__'
      ? thinkingValue as ReasoningEffort
      : undefined;
    if (directValue) dependencies.updateProjectModel(project.name, modelToSet ?? '', provider);
    if (thinkingValue) dependencies.updateProjectReasoning(project.name, reasoningToSet, provider);
    const changes = [
      directValue ? `model set to \`${modelToSet || 'provider default'}\`` : undefined,
      thinkingValue ? `thinking depth set to \`${reasoningToSet || 'provider/model default'}\`` : undefined,
    ].filter((value): value is string => Boolean(value));
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Model Updated')
        .setDescription(`${provider} settings for **${project.name}**: ${changes.join('; ')}.`)
        .setTimestamp()],
    });
    return;
  }

  if (provider !== 'claude') {
    await interaction.reply({
      content: `Current Codex model: \`${currentModel}\`.\nThinking depth: \`${currentReasoning}\`.\nSet the model with \`custom\` and the thinking depth with \`thinking\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`model_select:${project.name}:${provider}`.slice(0, 100))
    .setPlaceholder('Choose a Claude model...')
    .addOptions(CLAUDE_MODEL_OPTIONS.map(option => {
      const builder = new StringSelectMenuOptionBuilder()
        .setLabel(option.label)
        .setValue(option.value)
        .setDescription(option.description);
      if (option.emoji) builder.setEmoji(option.emoji);
      if (option.value === project.models?.claude
        || (option.value === '__default__' && !project.models?.claude)) {
        builder.setDefault(true);
      }
      return builder;
    }));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  const reply = await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 Claude Model Picker')
      .setDescription(`Current model: \`${currentModel}\`.`)
      .setTimestamp()],
    components: [row],
    fetchReply: true,
  });

  try {
    const selection = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
      filter: candidate => candidate.user.id === interaction.user.id,
    });
    const selected = selection.values[0];
    const modelToSet = selected === '__default__' ? '' : selected;
    dependencies.updateProjectModel(project.name, modelToSet, provider);
    selectMenu.setDisabled(true);
    await selection.update({
      embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Model Updated')
        .setDescription(`Claude model for **${project.name}** set to \`${modelToSet || 'provider default'}\`.`)
        .setTimestamp()],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
    });
  } catch {
    selectMenu.setDisabled(true);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('⏰ Model Selection Timed Out')
        .setDescription(`No selection made. Current model remains \`${currentModel}\`.`)],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
    }).catch(() => undefined);
  }
}

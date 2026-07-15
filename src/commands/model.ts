import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { Project } from '../types.js';
import {
  getProjectByChannel,
  updateProjectModel,
} from '../services/projectStore.js';

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
  defaultClaudeModel: string;
}

function defaultDependencies(): ModelCommandDependencies {
  return {
    getProjectByChannel,
    updateProjectModel,
    defaultClaudeModel: process.env.CLAUDE_MODEL ?? '',
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
      ephemeral: true,
    });
    return;
  }

  const project = dependencies.getProjectByChannel(interaction.channelId);
  if (!project || interaction.channelId !== project.agentChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project channel.', ephemeral: true });
    return;
  }

  const provider = project.defaultProvider;
  const pickedModel = interaction.options.getString('model');
  const customValue = interaction.options.getString('custom');
  const directValue = pickedModel || customValue;
  const currentModel = project.models?.[provider]
    || (provider === 'claude' ? dependencies.defaultClaudeModel : '')
    || 'provider default';

  if (directValue) {
    const modelToSet = directValue === '__default__' ? '' : directValue;
    dependencies.updateProjectModel(project.name, modelToSet, provider);
    const display = modelToSet || 'provider default';
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Model Updated')
        .setDescription(`${provider} model for **${project.name}** set to \`${display}\`.`)
        .setTimestamp()],
    });
    return;
  }

  if (provider !== 'claude') {
    await interaction.reply({
      content: `Current Codex model: \`${currentModel}\`. Set a Codex model with the \`custom\` option, or clear it with \`custom:__default__\`.`,
      ephemeral: true,
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

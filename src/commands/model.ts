import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { updateProjectModel } from '../services/projectStore.js';
import { config } from '../config.js';

/**
 * Well-known model choices for the picker. The SDK aliases (sonnet/opus/haiku)
 * always resolve to the latest model of each tier, so they never go stale.
 * Exact model IDs can still be set via the `custom` option.
 */
const MODEL_OPTIONS: Array<{ label: string; value: string; description: string; emoji?: string }> = [
  { label: 'Claude Sonnet', value: 'sonnet', description: 'Balanced speed & capability (recommended)', emoji: '⚡' },
  { label: 'Claude Opus', value: 'opus', description: 'Most powerful reasoning', emoji: '🧠' },
  { label: 'Claude Haiku', value: 'haiku', description: 'Fastest, lightweight tasks', emoji: '🪶' },
  { label: 'Default (env/SDK)', value: '__default__', description: 'Use CLAUDE_MODEL env var or SDK default', emoji: '🔄' },
];

export async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProjectByChannel(channelId);

  if (!project) {
    await interaction.reply({
      content: 'This command can only be used in a project channel.',
      ephemeral: true,
    });
    return;
  }

  // Determine current model
  const currentModel = project.model || config.defaultModel || 'SDK default';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🤖 Model Picker')
    .setDescription(`**Current model:** \`${currentModel}\`\n\nSelect a model from the dropdown, or use \`/model\` with the \`custom\` option to set any model name.`)
    .setTimestamp();

  // Check both the inline choice picker and the custom text option
  const pickedModel = interaction.options.getString('model');
  const customValue = interaction.options.getString('custom');
  const directValue = pickedModel || customValue;

  if (directValue) {
    // Direct set via /model model:<choice> or /model custom:<value>
    const modelToSet = directValue === '__default__' ? '' : directValue;
    updateProjectModel(project.name, modelToSet);

    const displayModel = modelToSet || 'SDK default';
    const selectedLabel = MODEL_OPTIONS.find(o => o.value === directValue)?.label ?? displayModel;
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Model Updated')
      .setDescription(`Model for **${project.name}** set to **${selectedLabel}** (\`${displayModel}\`)`)
      .setTimestamp();

    await interaction.reply({ embeds: [confirmEmbed] });
    return;
  }

  // Show interactive picker
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('model_select')
    .setPlaceholder('Choose a model...')
    .addOptions(
      MODEL_OPTIONS.map(opt => {
        const builder = new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setDescription(opt.description);
        if (opt.emoji) builder.setEmoji(opt.emoji);
        // Mark current model as default
        if (opt.value === project.model || (opt.value === '__default__' && !project.model)) {
          builder.setDefault(true);
        }
        return builder;
      })
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const reply = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  // Wait for selection
  try {
    const selectInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
    });

    const selected = selectInteraction.values[0];
    const modelToSet = selected === '__default__' ? '' : selected;
    updateProjectModel(project.name, modelToSet);

    const displayModel = modelToSet || 'SDK default';
    const selectedLabel = MODEL_OPTIONS.find(o => o.value === selected)?.label ?? selected;

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Model Updated')
      .setDescription(`Model for **${project.name}** set to **${selectedLabel}** (\`${displayModel}\`)`)
      .setTimestamp();

    // Disable the select menu
    selectMenu.setDisabled(true);
    const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await selectInteraction.update({ embeds: [confirmEmbed], components: [disabledRow] });
  } catch {
    // Timeout — disable menu
    selectMenu.setDisabled(true);
    const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    const timeoutEmbed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('⏰ Model Selection Timed Out')
      .setDescription(`No selection made. Current model remains \`${currentModel}\`.`);

    await interaction.editReply({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
  }
}

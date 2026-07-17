import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { getFactoryFloorBridgeService } from '../services/factoryFloorBridgeRegistry.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactErrorMessage } from '../utils/redaction.js';

function bridge() {
  const value = getFactoryFloorBridgeService();
  if (!value) throw new Error('Factory Floor integration is disabled or unavailable');
  return value;
}

function criteria(value: string | null): string[] {
  const items = value
    ?.split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
  return items?.length
    ? items.slice(0, 20)
    : ['The requested change is implemented and relevant verification passes.'];
}

export async function handleFactoryFloor(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getSubcommand();
  const service = bridge();

  if (action === 'status') {
    await interaction.deferReply({ ephemeral: true });
    const status = await service.getFactoryStatus(`discord:${interaction.user.id}`);
    const embed = new EmbedBuilder()
      .setTitle('Factory Floor')
      .setDescription(`Control plane status: **${status.status}**`)
      .addFields(
        { name: 'Ready deliveries', value: String(status.readyDeliveries ?? 0), inline: true },
        { name: 'Active executions', value: String(status.activeExecutions ?? 0), inline: true },
        { name: 'Pending approvals', value: String(status.pendingApprovals ?? 0), inline: true },
        { name: 'Recent failures', value: String(status.recentFailures ?? 0), inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (action === 'submit') {
    const objective = interaction.options.getString('objective', true).trim();
    const repository =
      interaction.options.getString('repository')?.trim() ||
      config.factoryFloorDefaultRepository;
    if (!repository) {
      await interaction.reply({
        content: 'Set `FACTORY_FLOOR_DEFAULT_REPOSITORY` or provide the `repository` option.',
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Factory Floor tasks require a guild channel.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'Creating a Factory Floor run…' });
    const starter = await interaction.fetchReply();
    const thread = await starter.startThread({
      name: `factory: ${objective}`.slice(0, 100),
      autoArchiveDuration: 60,
    });
    const statusMessage = await thread.send('Submitting the durable task to Factory Floor…');
    const project = getProjectByChannel(interaction.channelId);

    try {
      const receipt = await service.submitTask(`discord:${interaction.user.id}`, {
        clientRequestId: interaction.id,
        repository,
        objective,
        acceptanceCriteria: criteria(interaction.options.getString('criteria')),
        authority: {
          mayCreateBranch: true,
          mayOpenDraftPullRequest: true,
          mayMerge: false,
        },
        metadata: {
          discordGuildId: interaction.guildId,
          discordChannelId: interaction.channelId,
          discordThreadId: thread.id,
          discordMessageId: starter.id,
          discordUserId: interaction.user.id,
        },
      });
      service.bindRun({
        receipt,
        projectName: project?.name ?? repository,
        repository,
        objective,
        requestedBy: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        threadId: thread.id,
        statusMessageId: statusMessage.id,
      });
      await service.refreshRun(receipt.runId, `discord:${interaction.user.id}`);
      await interaction.editReply({
        content: `Factory Floor run \`${receipt.runId}\` is bound to <#${thread.id}>.`,
      });
    } catch (error) {
      const message = redactErrorMessage(error);
      await statusMessage.edit(`Factory Floor submission failed: ${message}`);
      await interaction.editReply({ content: `Unable to submit the Factory Floor task: ${message}` });
    }
    return;
  }

  if (action === 'run') {
    await interaction.deferReply({ ephemeral: true });
    const requested = interaction.options.getString('run-id')?.trim();
    const binding = requested
      ? service.findByRunId(requested)
      : service.findByThreadId(interaction.channelId);
    if (!binding) {
      await interaction.editReply('No bound Factory Floor run was found. Provide `run-id` or use this command in its task thread.');
      return;
    }
    const status = await service.refreshRun(binding.runId, `discord:${interaction.user.id}`);
    await interaction.editReply(`Run \`${binding.runId}\` refreshed: **${status.status}**.`);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const approvals = await service.listApprovals(interaction.user.id, 5);
  if (approvals.length === 0) {
    await interaction.editReply('Factory Floor has no pending approvals.');
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('Pending Factory Floor approvals')
    .setDescription('Approve only actions you have reviewed. Decisions are durably attributed to your Discord identity.')
    .addFields(
      approvals.map(item => ({
        name: `${item.policy_name ?? 'Policy'} · ${item.id}`.slice(0, 256),
        value: [
          item.reason,
          item.subject_kind && item.subject_id
            ? `Subject: ${item.subject_kind} \`${item.subject_id}\``
            : undefined,
        ].filter(Boolean).join('\n').slice(0, 1024) || 'No additional context supplied.',
      })),
    );
  const rows = approvals.map(item =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ff_approve:${item.id}`)
        .setLabel(`Approve ${item.id.slice(0, 8)}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ff_reject:${item.id}`)
        .setLabel(`Reject ${item.id.slice(0, 8)}`)
        .setStyle(ButtonStyle.Danger),
    ),
  );
  await interaction.editReply({ embeds: [embed], components: rows });
}

export async function handleFactoryFloorButton(
  interaction: ButtonInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith('ff_')) return false;
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
  if (!isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized.', ephemeral: true });
    return true;
  }
  const service = getFactoryFloorBridgeService();
  if (!service) {
    await interaction.reply({ content: 'Factory Floor integration is disabled.', ephemeral: true });
    return true;
  }

  const [action, id] = interaction.customId.split(':', 2);
  if (!id) {
    await interaction.reply({ content: 'Malformed Factory Floor action.', ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (action === 'ff_refresh') {
      const status = await service.refreshRun(id, `discord:${interaction.user.id}`);
      await interaction.editReply(`Run \`${id}\` refreshed: **${status.status}**.`);
    } else if (action === 'ff_cancel') {
      const status = await service.cancelRun(id, interaction.user.id, interaction.id);
      await interaction.editReply(`Cancellation recorded. Run \`${id}\` is **${status.status}**.`);
    } else if (action === 'ff_approve' || action === 'ff_reject') {
      const decision = action === 'ff_approve' ? 'approve' : 'reject';
      await service.decideApproval(id, interaction.user.id, interaction.id, decision);
      await interaction.editReply(`${decision === 'approve' ? 'Approved' : 'Rejected'} Factory Floor approval \`${id}\`.`);
    } else {
      await interaction.editReply('Unknown Factory Floor action.');
    }
  } catch (error) {
    await interaction.editReply(`Factory Floor action failed: ${redactErrorMessage(error)}`);
  }
  return true;
}

import { createHash } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type AnyThreadChannel,
  type GuildMember,
  type Message,
} from 'discord.js';
import type {
  ApprovalDecision,
  ApprovalRequest,
  UserAnswer,
  UserQuestion,
} from '../agents/contracts.js';

const DEFAULT_TIMEOUT_MS = 300_000;

export interface InteractionBroker {
  requestApproval(thread: AnyThreadChannel, request: ApprovalRequest): Promise<ApprovalDecision>;
  requestUserInput(thread: AnyThreadChannel, question: UserQuestion): Promise<UserAnswer>;
}

export interface DiscordInteractionBrokerOptions {
  timeoutMs?: number;
  isAuthorizedMember?: (member: GuildMember | unknown) => Promise<boolean> | boolean;
}

export class DiscordInteractionBroker implements InteractionBroker {
  private readonly timeoutMs: number;
  private readonly authorize: (member: GuildMember | unknown) => Promise<boolean>;

  constructor(options: DiscordInteractionBrokerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.authorize = async member => {
      if (options.isAuthorizedMember) return options.isAuthorizedMember(member);
      const { isAuthorized } = await import('../utils/permissions.js');
      return isAuthorized(member as GuildMember | null | undefined);
    };
  }

  async requestApproval(
    thread: AnyThreadChannel,
    request: ApprovalRequest,
  ): Promise<ApprovalDecision> {
    const allowId = componentId(thread.id, request.id, 'allow');
    const denyId = componentId(thread.id, request.id, 'deny');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(allowId).setLabel('Allow').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(denyId).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Approval required')
      .setDescription(truncate(request.details, 4_000))
      .addFields(
        { name: 'Action', value: truncate(request.title, 1_024), inline: false },
        { name: 'Type', value: request.kind.replace('_', ' '), inline: true },
        ...(request.risk ? [{ name: 'Risk', value: request.risk, inline: true }] : []),
      )
      .setTimestamp();

    const message = await thread.send({ embeds: [embed], components: [row] });
    const deadline = Date.now() + this.timeoutMs;
    let decision: ApprovalDecision = 'timeout';

    while (Date.now() < deadline) {
      const interaction = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: Math.max(1, deadline - Date.now()),
      }).catch(() => null);
      if (!interaction) break;

      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
      if (!await this.authorize(member)) {
        await interaction.reply({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        continue;
      }

      if (interaction.customId !== allowId && interaction.customId !== denyId) continue;
      await interaction.deferUpdate().catch(() => undefined);
      decision = interaction.customId === allowId ? 'allow' : 'deny';
      break;
    }

    await disableButtons(message, [
      { id: allowId, label: 'Allow', style: ButtonStyle.Success },
      { id: denyId, label: 'Deny', style: ButtonStyle.Danger },
    ]);
    return decision;
  }

  async requestUserInput(
    thread: AnyThreadChannel,
    question: UserQuestion,
  ): Promise<UserAnswer> {
    const embed = new EmbedBuilder()
      .setTitle('💬 Question')
      .setDescription(truncate(question.prompt, 4_000))
      .setTimestamp();

    if (question.options?.length) {
      return this.requestOptionInput(thread, question, embed);
    }
    return this.requestFreeText(thread, question, embed);
  }

  private async requestOptionInput(
    thread: AnyThreadChannel,
    question: UserQuestion,
    embed: EmbedBuilder,
  ): Promise<UserAnswer> {
    const options = question.options ?? [];
    if (options.length <= 5 && !question.multiple) {
      const ids = options.map((_, index) => componentId(thread.id, question.id, `option-${index}`));
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...options.map((option, index) => new ButtonBuilder()
          .setCustomId(ids[index])
          .setLabel(truncate(option.label, 80))
          .setStyle(ButtonStyle.Primary)),
      );
      const message = await thread.send({ embeds: [embed], components: [row] });
      const answer = await this.collectButtonAnswer(message, ids, options.map(option => option.value));
      await disableButtons(message, options.map((option, index) => ({
        id: ids[index],
        label: truncate(option.label, 80),
        style: ButtonStyle.Primary,
      })));
      return answer;
    }

    const selectId = componentId(thread.id, question.id, 'select');
    const visibleOptions = options.slice(0, 25);
    const encodedValues = visibleOptions.map((_, index) => `option-${index}`);
    const select = buildSelect(selectId, question, visibleOptions, encodedValues, false);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const message = await thread.send({ embeds: [embed], components: [row] });
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const interaction = await message.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: Math.max(1, deadline - Date.now()),
      }).catch(() => null);
      if (!interaction) break;
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
      if (!await this.authorize(member)) {
        await interaction.reply({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        continue;
      }
      if (interaction.customId !== selectId) continue;
      await interaction.deferUpdate().catch(() => undefined);
      await disableSelect(message, selectId, question, visibleOptions, encodedValues);
      const values = interaction.values.flatMap(encoded => {
        const index = encodedValues.indexOf(encoded);
        return index < 0 ? [] : [visibleOptions[index].value];
      });
      return values.length > 0
        ? { skipped: false, values }
        : { skipped: true, values: [] };
    }

    await disableSelect(message, selectId, question, visibleOptions, encodedValues);
    return { skipped: true, values: [] };
  }

  private async collectButtonAnswer(
    message: Message,
    ids: readonly string[],
    values: readonly string[],
  ): Promise<UserAnswer> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const interaction = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: Math.max(1, deadline - Date.now()),
      }).catch(() => null);
      if (!interaction) break;
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
      if (!await this.authorize(member)) {
        await interaction.reply({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        continue;
      }
      const index = ids.indexOf(interaction.customId);
      if (index < 0) continue;
      await interaction.deferUpdate().catch(() => undefined);
      return { skipped: false, values: [values[index]] };
    }
    return { skipped: true, values: [] };
  }

  private async requestFreeText(
    thread: AnyThreadChannel,
    question: UserQuestion,
    embed: EmbedBuilder,
  ): Promise<UserAnswer> {
    await thread.send({ embeds: [embed] });
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const messages = await thread.awaitMessages({
        max: 1,
        time: Math.max(1, deadline - Date.now()),
        filter: candidate => !candidate.author.bot,
      }).catch(() => null);
      const reply = messages?.first();
      if (!reply) break;
      const member = await reply.guild?.members.fetch(reply.author.id).catch(() => null) ?? null;
      if (!await this.authorize(member)) continue;
      return { skipped: false, values: [reply.content] };
    }

    return { skipped: true, values: [] };
  }
}

function componentId(threadId: string, requestId: string, action: string): string {
  const digest = createHash('sha256')
    .update(`${threadId}\0${requestId}\0${action}`)
    .digest('hex')
    .slice(0, 24);
  return `agent:${action.slice(0, 32)}:${digest}`;
}

function buildSelect(
  selectId: string,
  question: UserQuestion,
  options: NonNullable<UserQuestion['options']>,
  encodedValues: readonly string[],
  disabled: boolean,
): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder('Choose an option')
    .setMinValues(1)
    .setMaxValues(question.multiple ? Math.min(options.length, 25) : 1)
    .setDisabled(disabled)
    .addOptions(options.map((option, index) => ({
      label: truncate(option.label, 100),
      value: encodedValues[index],
      ...(option.description ? { description: truncate(option.description, 100) } : {}),
    })));
}

async function disableSelect(
  message: Message,
  selectId: string,
  question: UserQuestion,
  options: NonNullable<UserQuestion['options']>,
  encodedValues: readonly string[],
): Promise<void> {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    buildSelect(selectId, question, options, encodedValues, true),
  );
  await message.edit({ components: [row] }).catch(() => undefined);
}

async function disableButtons(
  message: Message,
  buttons: ReadonlyArray<{ id: string; label: string; style: ButtonStyle }>,
): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...buttons.map(button => new ButtonBuilder()
      .setCustomId(button.id)
      .setLabel(button.label)
      .setStyle(button.style)
      .setDisabled(true)),
  );
  await message.edit({ components: [row] }).catch(() => undefined);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

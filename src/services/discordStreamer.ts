import {
  AnyThreadChannel,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { config } from '../config.js';
import { chunkText } from '../utils/chunker.js';
import { isAuthorized } from '../utils/permissions.js';

const EDIT_INTERVAL_MS = 1500;

export class DiscordStreamer {
  private thread: AnyThreadChannel;
  private buffer = '';
  private currentMessage: Message | null = null;
  private editTimer: ReturnType<typeof setInterval> | null = null;
  private finalized = false;
  private dirty = false;

  constructor(thread: AnyThreadChannel) {
    this.thread = thread;
  }

  start(): void {
    this.editTimer = setInterval(() => this.flush(), EDIT_INTERVAL_MS);
  }

  append(text: string): void {
    this.buffer += text;
    this.dirty = true;

    if (this.buffer.length > 1800 && this.currentMessage) {
      this.finalizeCurrentMessage();
    }
  }

  private async flush(): Promise<void> {
    if (this.finalized || !this.dirty || this.buffer.length === 0) return;
    this.dirty = false;

    const display = this.buffer.slice(0, 1800);

    try {
      if (!this.currentMessage) {
        this.currentMessage = await this.thread.send(wrapCodeBlock(display) + ' ▍');
      } else {
        await this.currentMessage.edit(wrapCodeBlock(display) + ' ▍');
      }
    } catch {
      // Rate limited or message deleted
    }
  }

  private async finalizeCurrentMessage(): Promise<void> {
    if (!this.currentMessage) return;

    const text = this.buffer.slice(0, 1800);
    this.buffer = this.buffer.slice(1800);
    this.dirty = true;

    try {
      await this.currentMessage.edit(wrapCodeBlock(text));
    } catch {
      // Ignore
    }

    this.currentMessage = null;
  }

  async sendToolUseEmbed(toolName: string, input: Record<string, unknown>): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`🔧 ${toolName}`)
      .setTimestamp();

    if (toolName === 'Edit' || toolName === 'Write') {
      const filePath = input.file_path as string ?? input.path as string ?? 'unknown';
      embed.setDescription(`**File:** \`${filePath}\``);
      if (input.old_string) {
        const old = String(input.old_string).slice(0, 500);
        const newStr = String(input.new_string ?? '').slice(0, 500);
        embed.addFields(
          { name: 'Replacing', value: '```\n' + old + '\n```' },
          { name: 'With', value: '```\n' + newStr + '\n```' }
        );
      }
    } else if (toolName === 'Bash') {
      const cmd = String(input.command ?? '').slice(0, 1000);
      embed.setDescription('```sh\n' + cmd + '\n```');
    } else if (toolName === 'Read') {
      embed.setDescription(`**File:** \`${input.file_path ?? ''}\``);
    } else {
      const preview = JSON.stringify(input, null, 2).slice(0, 1000);
      embed.setDescription('```json\n' + preview + '\n```');
    }

    try {
      await this.thread.send({ embeds: [embed] });
    } catch {
      // Ignore
    }
  }

  async sendToolResultEmbed(toolName: string, output: string): Promise<void> {
    if (!output || output.length === 0) return;

    const truncated = output.slice(0, 1000);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✓ ${toolName} result`)
      .setDescription('```\n' + truncated + '\n```');

    try {
      await this.thread.send({ embeds: [embed] });
    } catch {
      // Ignore
    }
  }

  async promptToolApproval(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<'allow' | 'deny'> {
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle(`⚠️ Permission Required: ${toolName}`)
      .setTimestamp();

    if (toolName === 'Bash') {
      embed.setDescription('```sh\n' + String(input.command ?? '').slice(0, 1000) + '\n```');
    } else if (toolName === 'Edit' || toolName === 'Write') {
      embed.setDescription(`**File:** \`${input.file_path ?? input.path ?? ''}\``);
    } else {
      embed.setDescription('```json\n' + JSON.stringify(input, null, 2).slice(0, 1000) + '\n```');
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('tool_allow')
        .setLabel('Allow')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tool_deny')
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
    );

    try {
      const msg = await this.thread.send({ embeds: [embed], components: [row] });

      // Collect-then-verify: awaitMessageComponent filter must be sync,
      // so we accept the interaction and verify auth with an async fetch after.
      const deadline = Date.now() + 300_000;
      let result: 'allow' | 'deny' = 'deny';

      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const interaction = await msg.awaitMessageComponent({
          componentType: ComponentType.Button,
          time: remaining,
        }).catch(() => null);

        if (!interaction) break; // Timeout

        // Verify authorization with a proper fetch
        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
        if (!isAuthorized(member)) {
          await interaction.reply({ content: 'You are not authorized.', ephemeral: true })
            .catch((e) => console.warn('[toolApproval] ephemeral reply failed:', e));
          continue; // Wait for another click
        }

        await interaction.deferUpdate();
        result = interaction.customId === 'tool_allow' ? 'allow' : 'deny';
        break;
      }

      // Disable buttons
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('tool_allow')
          .setLabel('Allow')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('tool_deny')
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );
      await msg.edit({ components: [disabledRow] }).catch(() => {});

      return result;
    } catch (err) {
      console.error('[toolApproval] Failed:', err);
      return 'deny';
    }
  }

  async promptAskUserQuestion(
    questions: Array<{ question: string; options?: Array<{ label: string; description?: string }> }>
  ): Promise<Record<string, string>> {
    const answers: Record<string, string> = {};

    for (const q of questions) {
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('💬 Claude has a question')
        .setDescription(q.question);

      if (q.options && q.options.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const opt of q.options.slice(0, 5)) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`ask_${opt.label}`)
              .setLabel(opt.label)
              .setStyle(ButtonStyle.Primary)
          );
        }

        const msg = await this.thread.send({ embeds: [embed], components: [row] });

        // Collect-then-verify pattern for async auth
        const askDeadline = Date.now() + 300_000;
        let answered = false;

        while (Date.now() < askDeadline) {
          const remaining = askDeadline - Date.now();
          if (remaining <= 0) break;

          const interaction = await msg.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: remaining,
          }).catch(() => null);

          if (!interaction) break; // Timeout

          const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
          if (!isAuthorized(member)) {
            await interaction.reply({ content: 'You are not authorized.', ephemeral: true })
              .catch((e) => console.warn('[askUser] ephemeral reply failed:', e));
            continue;
          }

          await interaction.deferUpdate();
          answers[q.question] = interaction.customId.replace('ask_', '');
          answered = true;
          break;
        }

        if (!answered) {
          answers[q.question] = q.options[0].label; // Default to first option on timeout
        }
      } else {
        // Free-text: wait for a message in the thread, then verify auth
        await this.thread.send({ embeds: [embed] });

        const textDeadline = Date.now() + 300_000;
        let textAnswer = 'skip';

        while (Date.now() < textDeadline) {
          const remaining = textDeadline - Date.now();
          if (remaining <= 0) break;

          const collected = await this.thread.awaitMessages({
            max: 1,
            time: remaining,
            filter: (m: Message) => !m.author.bot,
          }).catch(() => null);

          const reply = collected?.first();
          if (!reply) break; // Timeout

          const member = await reply.guild?.members.fetch(reply.author.id).catch(() => null) ?? null;
          if (!isAuthorized(member)) {
            // Silently ignore unauthorized messages to avoid leaking auth state
            continue;
          }

          textAnswer = reply.content;
          break;
        }

        answers[q.question] = textAnswer;
      }
    }

    return answers;
  }

  async finish(
    result: { exitType: string; cost?: number; duration?: number; sessionId?: string } | null
  ): Promise<void> {
    this.finalized = true;

    if (this.editTimer) {
      clearInterval(this.editTimer);
      this.editTimer = null;
    }

    // Flush remaining buffer
    if (this.buffer.length > 0) {
      const chunks = chunkText(this.buffer);
      for (const chunk of chunks) {
        if (this.currentMessage) {
          try { await this.currentMessage.edit(wrapCodeBlock(chunk)); } catch {}
          this.currentMessage = null;
        } else {
          try { await this.thread.send(wrapCodeBlock(chunk)); } catch {}
        }
      }
    } else if (this.currentMessage) {
      try {
        const content = this.currentMessage.content.replace(/ ▍$/, '');
        await this.currentMessage.edit(content);
      } catch {}
    }

    // Summary embed
    const isSuccess = result?.exitType === 'success';
    const embed = new EmbedBuilder()
      .setColor(isSuccess ? 0x2ecc71 : 0xe74c3c)
      .setTitle(isSuccess ? '✅ Ready for next prompt' : '❌ Session error')
      .setTimestamp();

    if (result) {
      if (result.cost != null) embed.addFields({ name: 'Est. Usage', value: `~$${result.cost.toFixed(4)} (included in sub)`, inline: true });
      if (result.duration != null) embed.addFields({ name: 'Duration', value: `${(result.duration / 1000).toFixed(1)}s`, inline: true });
      if (result.sessionId) embed.addFields({ name: 'Session', value: `\`${result.sessionId.slice(0, 8)}\``, inline: true });
    }

    const ping = config.notifyUserId ? `<@${config.notifyUserId}>` : '';
    try { await this.thread.send({ content: ping, embeds: [embed] }); } catch {}
  }
}

function wrapCodeBlock(text: string): string {
  const escaped = text.replace(/```/g, '`\u200b``');
  return '```\n' + escaped + '\n```';
}

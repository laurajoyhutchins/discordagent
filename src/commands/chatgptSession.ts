import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import {
  createChatgptSessionRepository,
  type ChatgptSessionRepository,
} from '../repositories/chatgptSessionRepository.js';
import { getProjectDatabase } from '../services/projectStore.js';

export interface ParsedChatgptConversationUrl {
  readonly conversationId: string;
  readonly conversationUrl: string;
}

export interface ChatgptSessionCommandDependencies {
  readonly repository: Pick<
    ChatgptSessionRepository,
    'bind' | 'findActiveByThreadId' | 'retireByThreadId'
  >;
}

function defaultDependencies(): ChatgptSessionCommandDependencies {
  return {
    repository: createChatgptSessionRepository(getProjectDatabase()),
  };
}

export function parseChatgptConversationUrl(value: string): ParsedChatgptConversationUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A literal ChatGPT conversation URL is required.');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'chatgpt.com' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('A literal ChatGPT conversation URL is required.');
  }

  const match = /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match) throw new Error('A literal ChatGPT conversation URL is required.');

  const conversationId = match[1]!;
  return {
    conversationId,
    conversationUrl: `https://chatgpt.com/c/${conversationId}`,
  };
}

async function replyExpectedError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> {
  const content = error instanceof Error ? error.message : 'The ChatGPT session binding could not be changed.';
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function handleChatgptSession(
  interaction: ChatInputCommandInteraction,
  injected?: ChatgptSessionCommandDependencies,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({
      content: 'Use `/chatgpt-session` inside the Discord thread that should represent the ChatGPT conversation.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dependencies = injected ?? defaultDependencies();
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'show') {
    const binding = dependencies.repository.findActiveByThreadId(channel.id);
    if (!binding) {
      await interaction.reply({
        content: 'This Discord thread is not bound to a ChatGPT conversation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: [
        `ChatGPT conversation: ${binding.chatgptConversationUrl}`,
        'Projection: metadata-only. Discord Agent does not read or mirror the ChatGPT transcript.',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'bind') {
    let parsed: ParsedChatgptConversationUrl;
    try {
      parsed = parseChatgptConversationUrl(interaction.options.getString('url', true));
    } catch (error) {
      await replyExpectedError(interaction, error);
      return;
    }

    try {
      const binding = dependencies.repository.bind({
        discordThreadId: channel.id,
        chatgptConversationId: parsed.conversationId,
        boundBy: interaction.user.id,
      });
      await interaction.reply({
        content: [
          `Bound this Discord thread to ${binding.chatgptConversationUrl}.`,
          'Projection: metadata-only. No ChatGPT messages are read, copied, or written.',
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyExpectedError(interaction, error);
    }
    return;
  }

  if (subcommand === 'unbind') {
    try {
      const binding = dependencies.repository.retireByThreadId(channel.id);
      await interaction.reply({
        content: binding
          ? `Unbound this Discord thread from ${binding.chatgptConversationUrl}. Historical binding evidence remains in SQLite.`
          : 'This Discord thread is not bound to a ChatGPT conversation.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyExpectedError(interaction, error);
    }
    return;
  }

  await interaction.reply({
    content: 'Unknown ChatGPT session action.',
    flags: MessageFlags.Ephemeral,
  });
}

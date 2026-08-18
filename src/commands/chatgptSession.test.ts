import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { commands } from './definitions.js';
import {
  handleChatgptSession,
  parseChatgptConversationUrl,
  type ChatgptSessionCommandDependencies,
} from './chatgptSession.js';

describe('/chatgpt-session command', () => {
  it('registers bind, show, and unbind subcommands', () => {
    const command = commands.find(item => item.name === 'chatgpt-session')?.toJSON();
    expect(command).toMatchObject({ name: 'chatgpt-session' });
    expect(command?.options?.map(option => option.name)).toEqual(['bind', 'show', 'unbind']);
  });

  it('accepts only literal chatgpt.com conversation URLs and canonicalizes them', () => {
    expect(parseChatgptConversationUrl(
      'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555?model=auto#bottom',
    )).toEqual({
      conversationId: '11111111-2222-3333-4444-555555555555',
      conversationUrl: 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
    });

    for (const invalid of [
      'http://chatgpt.com/c/conversation-1',
      'https://chatgpt.com/share/conversation-1',
      'https://chat.openai.com/c/conversation-1',
      'https://chatgpt.com.evil.example/c/conversation-1',
      'not-a-url',
    ]) {
      expect(() => parseChatgptConversationUrl(invalid)).toThrow(/ChatGPT conversation URL/i);
    }
  });

  it('binds the current Discord thread without reading or writing ChatGPT content', async () => {
    const bind = vi.fn(() => ({
      id: 'binding-1',
      discordThreadId: 'thread-1',
      chatgptConversationId: 'conversation-1',
      chatgptConversationUrl: 'https://chatgpt.com/c/conversation-1',
      boundBy: 'user-1',
      boundAt: 100,
    }));
    const dependencies: ChatgptSessionCommandDependencies = {
      repository: {
        bind,
        findActiveByThreadId: vi.fn(() => undefined),
        retireByThreadId: vi.fn(() => undefined),
      },
    };
    const reply = vi.fn(async () => undefined);
    const interaction = {
      channel: { id: 'thread-1', isThread: () => true },
      user: { id: 'user-1' },
      options: {
        getSubcommand: () => 'bind',
        getString: () => 'https://chatgpt.com/c/conversation-1',
      },
      reply,
    } as unknown as ChatInputCommandInteraction;

    await handleChatgptSession(interaction, dependencies);

    expect(bind).toHaveBeenCalledWith({
      discordThreadId: 'thread-1',
      chatgptConversationId: 'conversation-1',
      boundBy: 'user-1',
    });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/metadata-only.*No ChatGPT messages are read, copied, or written/is),
    }));
  });

  it('refuses to bind outside a Discord thread before touching persistence', async () => {
    const bind = vi.fn();
    const dependencies: ChatgptSessionCommandDependencies = {
      repository: {
        bind,
        findActiveByThreadId: vi.fn(() => undefined),
        retireByThreadId: vi.fn(() => undefined),
      },
    };
    const reply = vi.fn(async () => undefined);
    const interaction = {
      channel: { id: 'channel-1', isThread: () => false },
      user: { id: 'user-1' },
      options: {
        getSubcommand: () => 'bind',
        getString: () => 'https://chatgpt.com/c/conversation-1',
      },
      reply,
    } as unknown as ChatInputCommandInteraction;

    await handleChatgptSession(interaction, dependencies);

    expect(bind).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/inside the Discord thread/i),
    }));
  });
});

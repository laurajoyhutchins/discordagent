import { describe, expect, it } from 'vitest';
import { commands } from './definitions.js';
import { parseChatgptConversationUrl } from './chatgptSession.js';

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
});

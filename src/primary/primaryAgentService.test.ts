import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import { createPrimaryAgentService } from './primaryAgentService.js';

function base(overrides: Record<string, unknown> = {}) {
  const reply = vi.fn();
  const append = vi.fn();
  const put = vi.fn();
  const service = createPrimaryAgentService({
    channelId: 'primary',
    ownerId: 'owner',
    model: { respond: async () => ({ reply: 'Here is the status.' }) },
    context: { assemble: () => '' },
    messages: { append } as never,
    memories: { put } as never,
    projects: {} as never,
    coordinator: {} as never,
    fetchProjectChannel: async () => null,
    ...overrides,
  } as never);
  return { service, reply, append, put };
}

function message(reply: ReturnType<typeof vi.fn>, content = 'status?') {
  return {
    id: 'm', channelId: 'primary', author: { id: 'owner', bot: false }, content,
    createdTimestamp: 1, reply, channel: { send: vi.fn() },
  } as never;
}

describe('primary agent service', () => {
  it('journals and replies without launching work when no proposal exists', async () => {
    const context = base();
    await context.service.handleMessage(message(context.reply));
    expect(context.append).toHaveBeenCalledTimes(2);
    expect(context.reply).toHaveBeenCalledWith('Here is the status.');
  });

  it('only promotes memory backed by an exact quote from the current user', async () => {
    const context = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [
          { namespace: 'user', key: 'review_style', value: 'draft', sourceQuote: 'I prefer draft PRs' },
          { namespace: 'user', key: 'invented', value: true, sourceQuote: 'I love surprise merges' },
        ],
      }) },
    });
    await context.service.handleMessage(message(context.reply, 'I prefer draft PRs until review.'));
    expect(context.put).toHaveBeenCalledTimes(1);
    expect(context.put).toHaveBeenCalledWith(expect.objectContaining({ key: 'review_style', sourceType: 'direct_user' }));
  });

  it('redacts sensitive memory values before persistence', async () => {
    const context = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [{ namespace: 'user', key: 'credential', value: { apiKey: 'sk-secret-value' }, sourceQuote: 'my credential' }],
      }) },
    });
    await context.service.handleMessage(message(context.reply, 'Please remember my credential.'));

    expect(context.put).toHaveBeenCalledWith(expect.objectContaining({ value: { apiKey: '[REDACTED]' } }));
  });

  it('records select-menu decisions and gives them back to the primary model', async () => {
    const update = vi.fn(async () => undefined);
    const edit = vi.fn(async () => undefined);
    const sent = {
      awaitMessageComponent: vi.fn(async () => ({
        id: 'interaction-1', user: { id: 'owner' }, values: ['1'], customId: 'primary_decision_select',
        isStringSelectMenu: () => true, update,
      })),
      edit,
    };
    const reply = vi.fn(async (payload: unknown) => typeof payload === 'object' ? sent : undefined);
    const respond = vi.fn()
      .mockResolvedValueOnce({ reply: 'Choose a path.', decision: { kind: 'select', prompt: 'Which scope?', options: ['Small', 'Full'] } })
      .mockResolvedValueOnce({ reply: 'We will use the full scope.' });
    const append = vi.fn();
    const service = createPrimaryAgentService({
      channelId: 'primary', ownerId: 'owner', model: { respond }, context: { assemble: () => 'context' },
      messages: { append } as never, memories: { put: vi.fn() } as never, projects: {} as never,
      coordinator: {} as never, fetchProjectChannel: async () => null,
    });
    await service.handleMessage(message(reply, 'Help me choose.'));
    expect(update).toHaveBeenCalledWith({ content: 'Decision recorded: **Full**', components: [] });
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Full') }));
    expect(reply).toHaveBeenCalledWith('We will use the full scope.');
  });

  it('renders structured provider failures as an error card instead of raw JSON', async () => {
    const rawError = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: 'The selected model is unavailable.' },
    });
    const reply = vi.fn(async () => undefined);
    const input = {
      author: { bot: false, id: 'owner-1' },
      channelId: 'agent-chat-1', content: 'Hello', createdTimestamp: 1, reply,
    } as unknown as Message;
    const service = createPrimaryAgentService({
      channelId: 'agent-chat-1', ownerId: 'owner-1',
      model: { respond: vi.fn(async () => ({ reply: `I could not complete the coordination turn: ${rawError}` })) },
      context: { assemble: vi.fn(() => 'context') } as never,
      messages: { append: vi.fn() } as never, memories: { put: vi.fn() } as never,
      projects: {} as never, coordinator: {} as never, fetchProjectChannel: vi.fn(),
    });

    await service.handleMessage(input);

    const calls = reply.mock.calls as unknown as Array<[unknown]>;
    const payload = calls[0]?.[0] as { embeds: Array<{ toJSON(): Record<string, unknown> }> };
    const embed = payload.embeds[0].toJSON();
    expect(payload).toHaveProperty('embeds');
    expect(embed.description).toContain('The selected model is unavailable.');
    expect(embed.description).not.toContain('{"type":"error"');
  });
});

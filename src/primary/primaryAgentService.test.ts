import { describe, expect, it, vi } from 'vitest';
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
});

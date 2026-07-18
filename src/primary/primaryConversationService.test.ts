import { describe, expect, it, vi } from 'vitest';
import { createPrimaryConversationService } from './primaryConversationService.js';

function base(overrides: Record<string, unknown> = {}) {
  const append = vi.fn();
  const put = vi.fn();
  const listActive = vi.fn().mockReturnValue([]);
  const findByName = vi.fn();
  const service = createPrimaryConversationService({
    model: { respond: async () => ({ reply: 'Here is the status.' }) },
    context: { assemble: () => '' },
    messages: { append, recent: vi.fn().mockReturnValue([]), search: vi.fn().mockReturnValue([]) } as never,
    memories: { put, list: vi.fn().mockReturnValue([]), get: vi.fn() } as never,
    projects: { listActive, findByName } as never,
    coordinator: {} as never,
    ...overrides,
  });
  return { service, append, put };
}

describe('primary conversation service', () => {
  it('returns a reply for ordinary input', async () => {
    const ctx = base();
    const result = await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'status?',
      createdAt: 1,
    });
    expect(result).toEqual({ kind: 'reply', text: 'Here is the status.' });
    expect(ctx.append).toHaveBeenCalledTimes(2);
  });

  it('returns a task proposal when the model proposes one', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'I can help with that.',
        taskProposal: { projectName: 'test-project', objective: 'Fix the bug' },
      }) },
    });
    const result = await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'fix the bug',
    });
    expect(result).toEqual({
      kind: 'task-proposal',
      text: 'I can help with that.',
      proposal: { projectName: 'test-project', objective: 'Fix the bug' },
      explicit: false,
    });
  });

  it('marks task proposals as explicit when the user uses intent keywords', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Starting work.',
        taskProposal: { projectName: 'test-project', objective: 'Fix the bug' },
      }) },
    });
    const result = await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'go ahead and fix the bug',
    });
    expect(result.kind).toBe('task-proposal');
    if (result.kind === 'task-proposal') {
      expect(result.explicit).toBe(true);
    }
  });

  it('returns a decision when the model asks for one', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Which approach?',
        decision: { kind: 'confirm', prompt: 'Use strict mode?', options: ['Yes', 'No'] },
      }) },
    });
    const result = await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'decide something',
    });
    expect(result).toEqual({
      kind: 'decision',
      text: 'Which approach?',
      decision: { kind: 'confirm', prompt: 'Use strict mode?', options: ['Yes', 'No'] },
    });
  });

  it('writes valid memory from user-quoted text', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [
          { namespace: 'user', key: 'review_style', value: 'draft', sourceQuote: 'I prefer draft PRs' },
        ],
      }) },
    });
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'I prefer draft PRs',
    });
    expect(ctx.put).toHaveBeenCalledTimes(1);
    expect(ctx.put).toHaveBeenCalledWith(expect.objectContaining({ key: 'review_style', namespace: 'user' }));
  });

  it('rejects memory writes without a matching source quote', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [
          { namespace: 'user', key: 'unrelated', value: true, sourceQuote: 'I love surprise merges' },
        ],
      }) },
    });
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'I prefer draft PRs',
    });
    expect(ctx.put).not.toHaveBeenCalled();
  });

  it('rejects memory writes with invalid namespace', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [
          { namespace: 'invalid', key: 'x', value: 'y', sourceQuote: 'test' },
        ],
      }) },
    });
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'this is a test',
    });
    expect(ctx.put).not.toHaveBeenCalled();
  });

  it('redacts sensitive values before memory persistence', async () => {
    const ctx = base({
      model: { respond: async () => ({
        reply: 'Noted.',
        memoryWrites: [
          { namespace: 'user', key: 'credential', value: { apiKey: 'sk-secret-12345' }, sourceQuote: 'credential' },
        ],
      }) },
    });
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'remember my credential',
    });
    expect(ctx.put).toHaveBeenCalledWith(expect.objectContaining({
      value: { apiKey: '[REDACTED]' },
    }));
  });

  it('resolves a decision and returns a follow-up reply', async () => {
    const respond = vi.fn()
      .mockResolvedValue({ reply: 'Proceeding with the plan.' });
    const ctx = base({ model: { respond } });
    const result = await ctx.service.resolveDecision({
      conversationId: 'conv-1',
      userId: 'owner',
      decisionPrompt: 'Proceed?',
      selectedOption: 'Yes',
    });
    expect(result).toEqual({ kind: 'reply', text: 'Proceeding with the plan.' });
    expect(ctx.append).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Decision: Proceed? — Yes',
    }));
  });

  it('persists messages on process', async () => {
    const ctx = base();
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'hello',
      createdAt: 100,
    });
    expect(ctx.append).toHaveBeenCalledTimes(2);
    expect(ctx.append).toHaveBeenNthCalledWith(1, expect.objectContaining({
      channelId: 'conv-1',
      authorId: 'owner',
      role: 'user',
      content: 'hello',
      createdAt: 100,
    }));
    expect(ctx.append).toHaveBeenNthCalledWith(2, expect.objectContaining({
      channelId: 'conv-1',
      authorId: 'primary-agent',
      role: 'assistant',
    }));
  });

  it('redacts sensitive content from persisted messages', async () => {
    const ctx = base({
      model: { respond: async () => ({ reply: 'Bearer sk-test-token' }) },
    });
    await ctx.service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'my token is Bearer abc12345',
    });
    const userCall = ctx.append.mock.calls[0][0];
    expect(userCall.content).toContain('[REDACTED]');
    const agentCall = ctx.append.mock.calls[1][0];
    expect(agentCall.content).toContain('[REDACTED]');
  });
});

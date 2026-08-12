import { describe, expect, it, vi } from 'vitest';
import { createPrimaryConversationService } from './primaryConversationService.js';

describe('primary conversation portfolio context safety', () => {
  it('withholds top-level hydration exception details from model context', async () => {
    const respond = vi.fn().mockResolvedValue({ reply: 'Authoritative context is unavailable.' });
    const service = createPrimaryConversationService({
      model: { respond },
      context: { assemble: () => '' },
      messages: { append: vi.fn(), recent: vi.fn().mockReturnValue([]), search: vi.fn().mockReturnValue([]) } as never,
      memories: { put: vi.fn(), list: vi.fn().mockReturnValue([]), get: vi.fn() } as never,
      projects: { listActive: vi.fn().mockReturnValue([]), findByName: vi.fn() } as never,
      coordinator: {} as never,
      portfolioContext: {
        hydrate: vi.fn().mockRejectedValue(
          new Error('failed at C:\\secrets\\linear.json API_KEY=sk-secret-12345'),
        ),
      },
    });

    await service.process({
      conversationId: 'conv-1',
      userId: 'owner',
      text: 'What is the current portfolio status?',
    });

    const modelInput = respond.mock.calls[0][0];
    expect(modelInput.context).toContain('AUTHORITATIVE PORTFOLIO CONTEXT unavailable');
    expect(modelInput.context).not.toContain('sk-secret-12345');
    expect(modelInput.context).not.toContain('C:\\secrets\\linear.json');
  });
});

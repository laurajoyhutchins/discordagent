import { describe, expect, it, vi } from 'vitest';
import type { AgentProvider } from '../agents/contracts.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { createTaskCoordinator } from './taskCoordinator.js';

describe('provider handoff', () => {
  it('estimates target context from source events', async () => {
    const providers = new ProviderRegistry();
    const target = { id: 'codex', checkAvailability: async () => ({ available: true }), estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 123, confidence: 'medium', explanation: 'estimate' })) } as unknown as AgentProvider;
    providers.register(target);
    const coordinator = createTaskCoordinator({
      projects: { findByName: () => undefined } as never,
      settings: { resolveTaskSettings: () => ({}) } as never,
      tasks: { findByThreadId: () => ({ id: 't', provider: 'claude', status: 'completed', objective: 'x' }), getResult: () => ({ summary: 'done' }) } as never,
      events: { list: () => [{ event: { type: 'text_delta', text: 'abc' } }, { event: { type: 'file_change', paths: ['a.ts'] } }] } as never,
      worktrees: {} as never, providers,
      rendererFactory: () => ({} as never), brokerFactory: () => ({} as never),
    });
    await expect(coordinator.estimateHandoff('thread', 'codex')).resolves.toMatchObject({ estimatedInputTokens: 123 });
    expect(target.estimateHandoff).toHaveBeenCalledWith(expect.objectContaining({ sourceProvider: 'claude', changedFiles: 1 }));
  });
});

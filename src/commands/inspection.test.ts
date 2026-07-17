import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { setAgentRuntimeServices, clearAgentRuntimeServices } from '../services/agentRuntimeService.js';
import { setUsageAdmissionService, clearUsageAdmissionService } from '../services/usageAdmissionRegistry.js';
import { handleAgents } from './agents.js';
import { handleUsage } from './usage.js';

beforeEach(() => {
  clearAgentRuntimeServices();
  clearUsageAdmissionService();
});

function interaction() {
  return {
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

describe('inspection commands', () => {
  it('reports active tasks with reservations', async () => {
    const tasks = { listActive: () => [{ id: 'task-123456', projectName: 'factory-floor', provider: 'codex', status: 'running', objective: 'Implement registry', threadId: 'thread-1' }] } as never;
    setAgentRuntimeServices({ providers: new ProviderRegistry(), tasks });
    setUsageAdmissionService({
      reservations: () => [{ id: 'r', taskId: 'task-123456', provider: 'codex', taskClass: 'contained_feature', low: 6, high: 14, confidence: 'low', status: 'active', createdAt: 1 }],
    } as never);
    const value = interaction();
    await handleAgents(value);
    expect(value.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array), flags: MessageFlags.Ephemeral }));
  });

  it('shows detailed provider posture only on demand', async () => {
    setUsageAdmissionService({
      posture: vi.fn(provider => ({ posture: provider === 'codex' ? 'restricted' : 'healthy', available: 30, reserved: 10 })),
      reservations: vi.fn(() => []),
    } as never);
    const value = interaction();
    await handleUsage(value);
    expect(value.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(value.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});

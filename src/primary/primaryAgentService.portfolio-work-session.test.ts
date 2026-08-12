import { describe, expect, it, vi } from 'vitest';
import { createPrimaryAgentService } from './primaryAgentService.js';

describe('primary portfolio work-session authorization', () => {
  it('requires a fresh owner capability selection even for an explicit start request', async () => {
    const update = vi.fn(async () => undefined);
    const edit = vi.fn(async () => undefined);
    const sent = {
      awaitMessageComponent: vi.fn(async () => ({
        user: { id: 'owner' },
        customId: 'primary_portfolio_capability',
        values: ['linear'],
        isStringSelectMenu: () => true,
        update,
      })),
      edit,
    };
    const reply = vi.fn(async (payload: unknown) => typeof payload === 'object' ? sent : undefined);
    const startFromMessage = vi.fn(async () => ({}));
    const runWithTaskSettingsOverride = vi.fn(async (_override: unknown, operation: () => Promise<unknown>) => operation());
    const settingsService = {
      mcpProfiles: () => ({ profiles: ['default', 'disabled', 'linear', 'drive'] }),
      runWithTaskSettingsOverride,
    };
    const project = {
      name: 'discordagent',
      workingDirectory: '/repo',
      categoryId: 'category',
      agentChannelId: 'agent-channel',
      defaultProvider: 'claude' as const,
    };
    const channel = { send: vi.fn(async () => ({ id: 'seed' })) };
    const conversationService = {
      process: vi.fn(async () => ({
        kind: 'task-proposal' as const,
        text: 'I can update the execution record.',
        proposal: {
          projectName: 'discordagent',
          objective: 'Update the current Linear execution record.',
          provider: 'claude' as const,
          portfolioCapability: true,
        },
        explicit: true,
      })),
      resolveDecision: vi.fn(),
      launchTask: vi.fn(),
    };
    const service = createPrimaryAgentService({
      channelId: 'primary',
      ownerId: 'owner',
      model: { respond: vi.fn() } as never,
      context: {} as never,
      messages: {} as never,
      memories: {} as never,
      projects: { findByName: () => project } as never,
      coordinator: { startFromMessage } as never,
      fetchProjectChannel: async () => channel as never,
      conversationService: conversationService as never,
      settingsService: settingsService as never,
    });

    await service.handleMessage({
      id: 'message',
      channelId: 'primary',
      author: { id: 'owner', bot: false },
      content: 'Go ahead and update Linear.',
      createdTimestamp: 1,
      reply,
    } as never);

    const proposalPayload = reply.mock.calls[0]?.[0] as {
      components: Array<{ components: Array<{ options: Array<{ value: string }> }> }>;
    };
    expect(proposalPayload.components[0].components[0].options.map(option => option.value))
      .toEqual(['linear', 'drive']);
    expect(runWithTaskSettingsOverride.mock.calls[0]?.[0]).toEqual({ mcpProfile: 'linear' });
    expect(startFromMessage).toHaveBeenCalledWith(expect.objectContaining({
      projectName: 'discordagent',
      prompt: 'Update the current Linear execution record.',
      provider: 'claude',
    }));
    expect(update).toHaveBeenCalledWith({
      content: 'Starting the delegated task with the bounded **linear** capability.',
      components: [],
    });
  });
});

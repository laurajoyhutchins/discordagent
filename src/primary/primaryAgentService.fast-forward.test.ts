import { describe, expect, it, vi } from 'vitest';
import { createPrimaryAgentService } from './primaryAgentService.js';

describe('primary Fast Forward work session', () => {
  it('authorizes only the composite profile and persists one live-skill bootstrap token', async () => {
    const update = vi.fn(async () => undefined);
    const edit = vi.fn(async () => undefined);
    const sent = {
      awaitMessageComponent: vi.fn(async () => ({
        user: { id: 'owner' },
        customId: 'primary_portfolio_capability',
        values: ['fast-forward'],
        isStringSelectMenu: () => true,
        update,
      })),
      edit,
    };
    const reply = vi.fn(async (payload: unknown) => typeof payload === 'object' ? sent : undefined);
    const startFromMessage = vi.fn(async (_input: unknown) => ({}));
    const runWithTaskSettingsOverride = vi.fn(async (_override: unknown, operation: () => Promise<unknown>) => operation());
    const settingsService = {
      mcpProfiles: () => ({
        profiles: ['default', 'disabled', 'github', 'linear', 'drive', 'fast-forward'],
      }),
      runWithTaskSettingsOverride,
    };
    const project = {
      name: 'discordagent',
      workingDirectory: '/repo',
      categoryId: 'category',
      agentChannelId: 'agent-channel',
      defaultProvider: 'claude' as const,
    };
    const channel = { send: vi.fn(async (_content: string) => ({ id: 'seed' })) };
    const conversationService = {
      process: vi.fn(async () => ({
        kind: 'task-proposal' as const,
        text: 'I can advance the live execution queue.',
        proposal: {
          projectName: 'discordagent',
          objective: 'Fast forward the current execution queue.',
          provider: 'claude' as const,
          portfolioCapability: true,
          fastForward: true,
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
      content: 'Fast forward.',
      createdTimestamp: 1,
      reply,
    } as never);

    const proposalPayload = reply.mock.calls[0]?.[0] as {
      components: Array<{ components: Array<{ options: Array<{ value: string }> }> }>;
    };
    expect(proposalPayload.components[0].components[0].options.map(option => option.value))
      .toEqual(['fast-forward']);
    expect(runWithTaskSettingsOverride.mock.calls[0]?.[0]).toEqual({ mcpProfile: 'fast-forward' });

    const launch = startFromMessage.mock.calls[0]?.[0] as { prompt: string };
    expect(launch.prompt).toContain('Fast forward the current execution queue.');
    expect(launch.prompt).toContain('FAST-FORWARD.SKILL.md');
    expect(launch.prompt).toContain('EXECUTION-OWNERSHIP.SKILL.md');
    expect(launch.prompt).toMatch(/Fast Forward work session token: ff-[a-f0-9]{8}/);
    expect(launch.prompt).not.toContain('FF_CLAIM');
    expect(launch.prompt).not.toContain('FF_RELEASE');

    const delegated = channel.send.mock.calls[0]?.[0] as string;
    const token = launch.prompt.match(/Fast Forward work session token: (ff-[a-f0-9]{8})/)?.[1];
    expect(token).toBeTruthy();
    expect(delegated).toContain(token);
    expect(update).toHaveBeenCalledWith({
      content: 'Starting the delegated task with the bounded **fast-forward** capability.',
      components: [],
    });
  });

  it('does not expose the composite profile to ordinary portfolio tasks', async () => {
    const sent = {
      awaitMessageComponent: vi.fn(async () => { throw new Error('stop after proposal'); }),
      edit: vi.fn(async () => undefined),
    };
    const reply = vi.fn(async (payload: unknown) => typeof payload === 'object' ? sent : undefined);
    const project = {
      name: 'discordagent',
      workingDirectory: '/repo',
      categoryId: 'category',
      agentChannelId: 'agent-channel',
      defaultProvider: 'claude' as const,
    };
    const service = createPrimaryAgentService({
      channelId: 'primary',
      ownerId: 'owner',
      model: { respond: vi.fn() } as never,
      context: {} as never,
      messages: {} as never,
      memories: {} as never,
      projects: { findByName: () => project } as never,
      coordinator: {} as never,
      fetchProjectChannel: async () => null,
      conversationService: {
        process: vi.fn(async () => ({
          kind: 'task-proposal' as const,
          text: 'I can inspect Linear.',
          proposal: {
            projectName: 'discordagent',
            objective: 'Inspect the current Linear issue.',
            provider: 'claude' as const,
            portfolioCapability: true,
          },
          explicit: true,
        })),
        resolveDecision: vi.fn(),
        launchTask: vi.fn(),
      } as never,
      settingsService: {
        mcpProfiles: () => ({
          profiles: ['default', 'disabled', 'github', 'linear', 'drive', 'fast-forward'],
        }),
      } as never,
    });

    await service.handleMessage({
      id: 'message',
      channelId: 'primary',
      author: { id: 'owner', bot: false },
      content: 'Inspect Linear.',
      createdTimestamp: 1,
      reply,
    } as never);

    const proposalPayload = reply.mock.calls[0]?.[0] as {
      components: Array<{ components: Array<{ options: Array<{ value: string }> }> }>;
    };
    expect(proposalPayload.components[0].components[0].options.map(option => option.value))
      .toEqual(['github', 'linear', 'drive']);
  });
});

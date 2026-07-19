import { describe, expect, it, vi } from 'vitest';
import type { GuildMember } from 'discord.js';
import type { FactoryFloorActivityLaunchService } from './activityLaunchService.js';
import {
  handleFactoryFloorActivityLaunch,
  type FactoryFloorActivityLaunchInteraction,
} from './activityLaunchHandler.js';

function interaction(overrides: Partial<FactoryFloorActivityLaunchInteraction> = {}) {
  const value = {
    id: 'interaction-1',
    applicationId: 'application-1',
    guildId: 'guild-1',
    channelId: 'agent-1',
    channel: { isThread: () => false, parentId: null },
    user: { id: 'user-1' },
    guild: {
      members: {
        fetch: vi.fn(async () => ({ id: 'user-1' } as GuildMember)),
      },
    },
    authorizingIntegrationOwners: new Map([[0, 'guild-1']]),
    launchActivity: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    ...overrides,
  } as FactoryFloorActivityLaunchInteraction & {
    launchActivity: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
  return value;
}

function service(result: Awaited<ReturnType<FactoryFloorActivityLaunchService['prepare']>>) {
  return {
    prepare: vi.fn(async () => result),
    invalidate: vi.fn(),
  } satisfies FactoryFloorActivityLaunchService;
}

describe('Factory Floor Activity launch interaction', () => {
  it('returns an actionable plain-text fallback while the adapter is disabled', async () => {
    const command = interaction();

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => undefined,
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/not enabled/i),
    }));
    expect(command.launchActivity).not.toHaveBeenCalled();
  });

  it('prepares trusted state and acknowledges LAUNCH_ACTIVITY for an authorized project channel', async () => {
    const command = interaction();
    const launchService = service({
      ok: true,
      stateId: 'opaque-state-1',
      contextKind: 'project',
      projectName: 'factory-floor',
    });

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => launchService,
      authorize: () => true,
    });

    expect(launchService.prepare).toHaveBeenCalledWith({
      interactionId: 'interaction-1',
      applicationId: 'application-1',
      installationType: 'guild',
      installationOwnerId: 'guild-1',
      guildId: 'guild-1',
      channelId: 'agent-1',
      principalId: 'user-1',
      authorized: true,
    });
    expect(command.launchActivity).toHaveBeenCalledOnce();
    expect(command.reply).not.toHaveBeenCalled();
  });

  it('maps a task thread to its parent project channel and exact thread identity', async () => {
    const command = interaction({
      channelId: 'thread-1',
      channel: { isThread: () => true, parentId: 'agent-1' },
    });
    const launchService = service({
      ok: true,
      stateId: 'opaque-state-1',
      contextKind: 'run',
      projectName: 'factory-floor',
      runId: 'run-1',
    });

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => launchService,
      authorize: () => true,
    });

    expect(launchService.prepare).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'agent-1',
      threadId: 'thread-1',
    }));
  });

  it('does not launch when trusted resolution fails', async () => {
    const command = interaction();
    const launchService = service({
      ok: false,
      code: 'ambiguous_run',
      message: 'Open the specific task thread first.',
    });

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => launchService,
      authorize: () => true,
    });

    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Open the specific task thread first.',
    }));
    expect(command.launchActivity).not.toHaveBeenCalled();
  });

  it('invalidates prepared state when Discord rejects the launch acknowledgement', async () => {
    const command = interaction({
      launchActivity: vi.fn(async () => { throw new Error('Unknown interaction'); }),
    });
    const launchService = service({
      ok: true,
      stateId: 'opaque-state-1',
      contextKind: 'project',
      projectName: 'factory-floor',
    });
    const logger = vi.fn();

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => launchService,
      authorize: () => true,
      logger,
    });

    expect(launchService.invalidate).toHaveBeenCalledWith(
      'opaque-state-1',
      'Discord LAUNCH_ACTIVITY callback failed',
    );
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/acknowledgement failed/i));
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/one-time launch was cancelled/i),
    }));
  });

  it('fails before state preparation when the guild installation owner is unavailable', async () => {
    const command = interaction({ authorizingIntegrationOwners: new Map() });
    const launchService = service({
      ok: true,
      stateId: 'should-not-exist',
      contextKind: 'project',
      projectName: 'factory-floor',
    });

    await handleFactoryFloorActivityLaunch(command, {
      getLaunchService: () => launchService,
      authorize: () => true,
    });

    expect(launchService.prepare).not.toHaveBeenCalled();
    expect(command.launchActivity).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/server installation/i),
    }));
  });
});

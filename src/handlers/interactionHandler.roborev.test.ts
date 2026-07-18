import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';

const mockHandleRoborev = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../commands/roborev.js', () => ({
  handleRoborev: mockHandleRoborev,
}));

vi.mock('../utils/permissions.js', () => ({
  isAuthorized: () => true,
}));

const { handleInteraction } = await import('./interactionHandler.js');

describe('RoboRev slash command routing', () => {
  beforeEach(() => {
    mockHandleRoborev.mockClear();
  });

  it('routes the roborev command to its handler', async () => {
    const command = {
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      isMessageContextMenuCommand: () => false,
      isChatInputCommand: () => true,
      commandName: 'roborev',
      user: { id: 'user-1' },
      guild: {
        members: {
          fetch: vi.fn(async () => ({})),
        },
      },
    } as never;

    await handleInteraction(command);

    expect(mockHandleRoborev).toHaveBeenCalledOnce();
    expect(mockHandleRoborev).toHaveBeenCalledWith(command);
  });
});

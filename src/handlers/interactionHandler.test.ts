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

const {
  handleInteraction,
  routeSettingsComponents,
  routeTaskControlComponents,
} = await import('./interactionHandler.js');

function interaction(kind: 'button' | 'select' | 'modal') {
  return {
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
  } as never;
}

describe('settings component routing', () => {
  it('routes buttons through the global/project settings boundary before generic buttons', async () => {
    const globalHandler = vi.fn(async () => true);
    const projectHandler = vi.fn(async () => false);

    await expect(routeSettingsComponents(interaction('button'), globalHandler, projectHandler)).resolves.toBe(true);
    expect(globalHandler).toHaveBeenCalledOnce();
    expect(projectHandler).not.toHaveBeenCalled();
  });

  it('routes select and modal interactions to the project boundary when global routing declines', async () => {
    const globalHandler = vi.fn(async () => false);
    const projectHandler = vi.fn(async () => true);

    await expect(routeSettingsComponents(interaction('select'), globalHandler, projectHandler)).resolves.toBe(true);
    await expect(routeSettingsComponents(interaction('modal'), globalHandler, projectHandler)).resolves.toBe(true);
    expect(projectHandler).toHaveBeenCalledTimes(2);
  });
});

describe('task control component routing', () => {
  it('routes buttons through the task-control boundary', async () => {
    const handler = vi.fn(async () => true);

    await expect(routeTaskControlComponents(interaction('button'), handler)).resolves.toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignores non-button interactions', async () => {
    const handler = vi.fn(async () => true);

    await expect(routeTaskControlComponents(interaction('select'), handler)).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('slash command routing', () => {
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

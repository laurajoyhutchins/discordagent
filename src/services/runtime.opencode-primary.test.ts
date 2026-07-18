import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';
import type { AgentProvider } from '../agents/contracts.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createSettingsRepository } from '../repositories/settingsRepository.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'false';
process.env.CODEX_ENABLED = 'false';
process.env.OPENCODE_ENABLED = 'true';

const { startRuntime, stopRuntime } = await import('./runtime.js');

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fakeOpenCodeProvider(): AgentProvider {
  return {
    id: 'opencode',
    checkAvailability: vi.fn(async () => ({ available: true })),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
  } as never;
}

describe('runtime OpenCode PM activation', () => {
  it('activates a saved OpenCode PM selection instead of returning to onboarding', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'discordagent-opencode-pm-'));
    directories.push(directory);
    const databasePath = join(directory, 'runtime.sqlite');
    const db = openDatabase(databasePath);
    runMigrations(db);
    createSettingsRepository(db).setDefaultProvider('opencode');
    db.close();

    const send = vi.fn(async () => ({ id: 'setup-message' }));
    const agentChannel = { id: 'agent-chat', messages: { fetch: vi.fn(async () => null) }, send };
    const guild = {
      id: 'guild-1',
      members: { me: { id: 'bot-1', permissions: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.ManageChannels,
      ]) } },
      channels: { cache: { find: () => undefined }, create: vi.fn(async () => agentChannel) },
    };
    const client = {
      user: { id: 'bot-1' },
      guilds: { fetch: vi.fn(async () => guild) },
      channels: { fetch: vi.fn(async () => null) },
    } as unknown as Client;
    const primaryModel = { respond: vi.fn(async () => ({ reply: 'ready' })) };

    const runtime = await startRuntime(client, {
      databasePath,
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      openCodeProvider: fakeOpenCodeProvider(),
      primaryModel,
      disableClaude: true,
      disableCodex: true,
    });

    expect(runtime.settings.getDefaultProvider()).toBe('opencode');
    expect(runtime.primaryAgent).toBeDefined();
    expect(send).not.toHaveBeenCalled();

    await stopRuntime(runtime);
  });
});

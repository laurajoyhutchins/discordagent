import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { AgentProvider, ProviderAvailability } from '../agents/contracts.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'true';

const { startRuntime, stopRuntime } = await import('./runtime.js');

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fakeProvider(): AgentProvider {
  return {
    id: 'claude',
    checkAvailability: vi.fn(async (): Promise<ProviderAvailability> => ({ available: true })),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({
      estimatedInputTokens: 0,
      confidence: 'low',
      explanation: 'test',
    })),
  } as AgentProvider;
}

describe('runtime portfolio context wiring', () => {
  it('hydrates authoritative evidence through the headless conversation path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'discordagent-runtime-portfolio-'));
    directories.push(directory);
    const hydrate = vi.fn().mockResolvedValue({
      hydratedAt: '2026-08-12T20:00:00Z',
      requestedSources: ['linear'],
      records: [
        {
          source: 'linear',
          sourceId: 'LJH-211',
          text: 'Hydration is In Progress',
          observedAt: '2026-08-12T19:50:32Z',
        },
      ],
      failures: [],
    });
    const respond = vi.fn().mockResolvedValue({ reply: 'LJH-211 is in progress.' });
    const client = {
      guilds: { cache: new Map() },
      channels: { fetch: vi.fn() },
    } as unknown as Client;

    const runtime = await startRuntime(client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disableCodex: true,
      disableOpenCode: true,
      headlessPrimaryAgent: true,
      primaryProvider: 'claude',
      primaryModel: { respond },
      portfolioContext: { hydrate },
    });

    const result = await runtime.conversationService!.process({
      conversationId: 'headless:primary',
      userId: 'owner',
      text: 'What is executable or blocked in Linear?',
      currentProjectName: 'discordagent',
    });

    expect(result).toEqual({ kind: 'reply', text: 'LJH-211 is in progress.' });
    expect(hydrate).toHaveBeenCalledWith({
      query: 'What is executable or blocked in Linear?',
      currentProjectName: 'discordagent',
    });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.stringContaining('[linear] LJH-211 @ 2026-08-12T19:50:32Z'),
    }));
    expect(client.channels.fetch).not.toHaveBeenCalled();

    await stopRuntime(runtime);
  });
});

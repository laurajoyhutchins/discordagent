import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import type { PrimaryConversationService } from '../primary/primaryConversationService.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'false';
process.env.CODEX_ENABLED = 'false';
process.env.OPENCODE_ENABLED = 'false';

const { getTaskCoordinator } = await import('./taskCoordinatorService.js');
const { getUsageAdmissionService } = await import('./usageAdmissionRegistry.js');
const { createHostMcpProfiles, startRuntime, stopRuntime } = await import('./runtime.js');

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-runtime-lifecycle-'));
  directories.push(directory);
  return directory;
}

function fakeClient(): Client {
  return {
    guilds: { cache: new Map() },
    channels: { fetch: vi.fn() },
  } as unknown as Client;
}

function fakeConversationService(): PrimaryConversationService {
  return {
    process: vi.fn(async () => ({ kind: 'reply' as const, text: 'ready' })),
    resolveDecision: vi.fn(async () => ({ kind: 'reply' as const, text: 'resolved' })),
    launchTask: vi.fn(async () => undefined),
  };
}

function runtimePaths(directory: string) {
  return {
    databasePath: join(directory, 'runtime.sqlite'),
    legacyPath: join(directory, 'missing-projects.json'),
    worktreesBaseDir: join(directory, 'worktrees'),
  };
}

describe('runtime phase teardown', () => {
  it('closes the project store when provider bootstrap fails', async () => {
    const directory = tempDirectory();
    const paths = runtimePaths(directory);
    const failure = new Error('provider bootstrap failed');

    await expect(startRuntime(fakeClient(), {
      ...paths,
      components: {
        providers: vi.fn(async () => { throw failure; }),
      },
    })).rejects.toBe(failure);

    const runtime = await startRuntime(fakeClient(), {
      ...paths,
      disablePrimaryAgent: true,
      components: {
        providers: async () => ({
          providers: new ProviderRegistry(),
          mcpProfiles: createHostMcpProfiles(),
          stop: async () => undefined,
        }),
        recovery: async () => ({ stop: async () => undefined }),
      },
    });
    await stopRuntime(runtime);
  });

  it('stops provider bootstrap when primary-agent setup fails', async () => {
    const directory = tempDirectory();
    const order: string[] = [];
    const failure = new Error('primary-agent setup failed');

    await expect(startRuntime(fakeClient(), {
      ...runtimePaths(directory),
      components: {
        providers: async () => ({
          providers: new ProviderRegistry(),
          mcpProfiles: createHostMcpProfiles(),
          stop: async () => { order.push('providers'); },
        }),
        primaryAgent: vi.fn(async () => { throw failure; }),
      },
    })).rejects.toBe(failure);

    expect(order).toEqual(['providers']);
    expect(() => getTaskCoordinator()).toThrow(/not initialized/i);
    expect(getUsageAdmissionService()).toBeUndefined();
  });

  it('stops primary-agent and provider components when usage setup fails', async () => {
    const directory = tempDirectory();
    const order: string[] = [];
    const failure = new Error('usage setup failed');

    await expect(startRuntime(fakeClient(), {
      ...runtimePaths(directory),
      components: {
        providers: async () => ({
          providers: new ProviderRegistry(),
          mcpProfiles: createHostMcpProfiles(),
          stop: async () => { order.push('providers'); },
        }),
        primaryAgent: async () => ({
          conversationService: fakeConversationService(),
          stop: async () => { order.push('primary'); },
        }),
        usage: vi.fn(async () => { throw failure; }),
      },
    })).rejects.toBe(failure);

    expect(order).toEqual(['primary', 'providers']);
  });

  it('stops usage, primary-agent, and provider components when recovery fails', async () => {
    const directory = tempDirectory();
    const order: string[] = [];
    const failure = new Error('recovery failed');

    await expect(startRuntime(fakeClient(), {
      ...runtimePaths(directory),
      components: {
        providers: async () => ({
          providers: new ProviderRegistry(),
          mcpProfiles: createHostMcpProfiles(),
          stop: async () => { order.push('providers'); },
        }),
        primaryAgent: async () => ({
          conversationService: fakeConversationService(),
          stop: async () => { order.push('primary'); },
        }),
        usage: async () => ({
          stop: async () => { order.push('usage'); },
        }),
        recovery: vi.fn(async () => { throw failure; }),
      },
    })).rejects.toBe(failure);

    expect(order).toEqual(['usage', 'primary', 'providers']);
  });
});

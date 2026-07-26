import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentProvider, ProviderAvailability } from '../agents/contracts.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'true';

const { startRuntime, stopRuntime } = await import('./runtime.js');

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function restoredDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-restored-startup-'));
  directories.push(directory);
  const databasePath = join(directory, 'runtime.sqlite');
  const database = openDatabase(databasePath);
  runMigrations(database);
  database.close();
  return databasePath;
}

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

describe('restored runtime startup', () => {
  it('runs idempotent migrations and recovery exactly once without starting a provider turn', async () => {
    const databasePath = restoredDatabasePath();
    const provider = fakeProvider();
    const recovery = vi.fn(async ({ tasks }: Parameters<NonNullable<Parameters<typeof startRuntime>[1]['components']>['recovery']>[0]) => {
      const migrationCount = tasks.database.raw
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get() as { count: number };
      expect(migrationCount.count).toBeGreaterThan(0);
      return { stop: vi.fn(async () => undefined) };
    });

    const runtime = await startRuntime({} as Client, {
      databasePath,
      legacyPath: join(databasePath, '..', 'missing-projects.json'),
      worktreesBaseDir: join(databasePath, '..', 'worktrees'),
      claudeProvider: provider,
      disablePrimaryAgent: true,
      disableUsagePolling: true,
      components: { recovery },
    });

    expect(recovery).toHaveBeenCalledTimes(1);
    expect(provider.startTask).not.toHaveBeenCalled();
    expect(provider.continueTask).not.toHaveBeenCalled();

    await stopRuntime(runtime);
  });
});

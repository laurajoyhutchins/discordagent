import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client, TextChannel } from 'discord.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { createSettingsRepository } from '../repositories/settingsRepository.js';
import { createTaskRepository } from '../repositories/taskRepository.js';
import { createUsageRepository } from '../repositories/usageRepository.js';
import type { AgentProvider, ProviderAvailability } from '../agents/contracts.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'true';

const { getTaskCoordinator } = await import('./taskCoordinatorService.js');
const { getUsageAdmissionService } = await import('./usageAdmissionRegistry.js');
const { startRuntime, stopRuntime } = await import('./runtime.js');

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-runtime-'));
  directories.push(directory);
  return directory;
}

function fakeProvider(id: AgentProvider['id'] = 'claude', availability: ProviderAvailability = { available: true }): AgentProvider {
  return {
    id,
    checkAvailability: vi.fn(async (): Promise<ProviderAvailability> => availability),
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

function onboardingClient(send: ReturnType<typeof vi.fn>): Client {
  const agentChannel = {
    id: 'agent-chat',
    messages: { fetch: vi.fn(async () => null) },
    send,
  };
  const guild = {
    id: 'guild-1',
    members: { me: { id: 'bot-1' } },
    channels: {
      cache: { find: () => undefined },
      create: vi.fn(async () => agentChannel),
    },
  };
  return { guilds: { fetch: vi.fn(async () => guild) } } as unknown as Client;
}

describe('runtime startup', () => {
  it('installs a durable coordinator and registered Claude provider before handlers run', async () => {
    const directory = tempDirectory();
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disablePrimaryAgent: true,
    });

    expect(getTaskCoordinator()).toBe(runtime.coordinator);
    expect(runtime.providers.require('claude').id).toBe('claude');
    expect(runtime.settings.getDefaultProvider()).toBeUndefined();
    expect(runtime.projects.listActive()).toEqual([]);
    expect(getUsageAdmissionService()).toBe(runtime.usage);

    await stopRuntime(runtime);
    expect(() => getTaskCoordinator()).toThrow(/not initialized/i);
    expect(getUsageAdmissionService()).toBeUndefined();
  });

  it('starts with Codex as the only registered provider when Claude is disabled', async () => {
    const directory = tempDirectory();
    const codex = { ...fakeProvider(), id: 'codex' as const };
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      codexProvider: codex,
      disableClaude: true,
      disablePrimaryAgent: true,
    });

    expect(runtime.providers.list()).toEqual(['codex']);

    await stopRuntime(runtime);
  });

  it('registers an injected OpenCode provider after its availability probe', async () => {
    const directory = tempDirectory();
    const opencode = fakeProvider('opencode');
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      openCodeProvider: opencode,
      disableClaude: true,
      disableCodex: true,
      disablePrimaryAgent: true,
    });

    expect(runtime.providers.require('opencode')).toBe(opencode);
    expect(opencode.checkAvailability).toHaveBeenCalledOnce();

    await stopRuntime(runtime);
  });

  it('omits an injected OpenCode provider when its availability probe fails', async () => {
    const directory = tempDirectory();
    const opencode = fakeProvider('opencode', { available: false, reason: 'OpenCode ACP unavailable: missing CLI token=secret' });
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      openCodeProvider: opencode,
      disableClaude: true,
      disableCodex: true,
      disablePrimaryAgent: true,
    });

    expect(runtime.providers.list()).not.toContain('opencode');
    expect(opencode.checkAvailability).toHaveBeenCalledOnce();

    await stopRuntime(runtime);
  });

  it('does not register an injected OpenCode provider when OpenCode is disabled', async () => {
    const directory = tempDirectory();
    const opencode = fakeProvider('opencode');
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      openCodeProvider: opencode,
      disableOpenCode: true,
      disableClaude: true,
      disableCodex: true,
      disablePrimaryAgent: true,
    });

    expect(runtime.providers.list()).not.toContain('opencode');
    expect(opencode.checkAvailability).not.toHaveBeenCalled();

    await stopRuntime(runtime);
  });

  it('posts provider onboarding in the PM channel before any provider is selected', async () => {
    const directory = tempDirectory();
    const send = vi.fn(async () => ({ id: 'setup-message' }));
    const runtime = await startRuntime(onboardingClient(send), {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disableCodex: true,
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/provider setup required/i) }));
    expect(runtime.primaryAgent).toBeUndefined();

    await stopRuntime(runtime);
  });

  it('clears an unavailable saved PM provider and returns to onboarding', async () => {
    const directory = tempDirectory();
    const databasePath = join(directory, 'runtime.sqlite');
    const db = openDatabase(databasePath);
    runMigrations(db);
    createSettingsRepository(db).setDefaultProvider('codex');
    db.close();
    const send = vi.fn(async () => ({ id: 'setup-message' }));

    const runtime = await startRuntime(onboardingClient(send), {
      databasePath,
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disableCodex: true,
    });

    expect(runtime.settings.getDefaultProvider()).toBeUndefined();
    expect(runtime.primaryAgent).toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/provider setup required/i) }));

    await stopRuntime(runtime);
  });

  it('cleans partial startup state when the injected provider is not Claude', async () => {
    const directory = tempDirectory();
    const provider = { ...fakeProvider(), id: 'codex' as const };

    await expect(startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: provider,
    })).rejects.toThrow(/Claude provider/i);

    expect(() => getTaskCoordinator()).toThrow(/not initialized/i);
  });

  it('uses an injected Codex provider without spawning the CLI and records authoritative windows', async () => {
    const directory = tempDirectory();
    const codex = { ...fakeProvider(), id: 'codex' as const };
    let publishRateLimits: ((windows: Array<{ name: string; remaining?: number; utilization?: number }>) => void) | undefined;
    const unsubscribe = vi.fn();
    const auth = {
      readRateLimits: vi.fn(async () => [{ name: 'primary', remaining: 42, utilization: 58 }]),
      onRateLimitsUpdated: vi.fn((listener: typeof publishRateLimits) => { publishRateLimits = listener; return unsubscribe; }),
      close: vi.fn(async () => undefined),
    };
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      codexProvider: codex,
      codexAuth: auth as never,
      disableUsagePolling: true,
      disablePrimaryAgent: true,
    });
    expect(runtime.providers.require('codex')).toBe(codex);
    expect(runtime.usage.posture('codex')).toMatchObject({ available: 42, posture: 'cautious' });
    publishRateLimits?.([{ name: 'primary', remaining: 8, utilization: 92 }]);
    expect(runtime.usage.posture('codex')).toMatchObject({ available: 8, posture: 'preserve' });
    await stopRuntime(runtime);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('releases stale pre-task usage holds during restart recovery', async () => {
    const directory = tempDirectory();
    const databasePath = join(directory, 'runtime.sqlite');
    const db = openDatabase(databasePath);
    runMigrations(db);
    const usage = createUsageRepository(db);
    usage.createHold({ provider: 'claude', taskClass: 'contained_feature', low: 6, high: 14, confidence: 'low' });
    db.close();

    const runtime = await startRuntime({} as Client, {
      databasePath,
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disableCodex: true,
      disablePrimaryAgent: true,
    });
    expect(runtime.usage.reservations()).toEqual([]);
    await stopRuntime(runtime);
  });

  it('marks nonterminal tasks interrupted and posts a recovery checkpoint without replaying them', async () => {
    const directory = tempDirectory();
    const databasePath = join(directory, 'runtime.sqlite');
    const db = openDatabase(databasePath);
    runMigrations(db);
    const projects = createProjectRepository(db);
    const tasks = createTaskRepository(db);
    projects.create({
      name: 'factory-floor',
      workingDirectory: join(directory, 'repo'),
      categoryId: 'category-1',
      agentChannelId: 'agent-1',
      defaultProvider: 'claude',
    });
    tasks.createWithWorktree({
      taskId: 'task-1',
      projectName: 'factory-floor',
      provider: 'claude',
      channelId: 'agent-1',
      threadId: 'thread-1',
      objective: 'finish the registry',
      worktree: {
        id: 'worktree-1',
        repositoryPath: join(directory, 'repo'),
        worktreePath: join(directory, 'missing-worktree'),
        branchName: 'agent/claude/registry-thread',
        baseRef: 'main',
      },
    });
    tasks.transition('task-1', ['created'], 'starting');
    db.close();

    const send = vi.fn(async () => undefined);
    const client = {
      channels: {
        fetch: vi.fn(async (id: string) => id === 'thread-1'
          ? ({ send } as unknown as TextChannel)
          : null),
      },
    } as unknown as Client;
    const provider = fakeProvider();

    const runtime = await startRuntime(client, {
      databasePath,
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: provider,
      disablePrimaryAgent: true,
    });

    expect(runtime.tasks.findById('task-1')?.status).toBe('interrupted');
    expect(provider.startTask).not.toHaveBeenCalled();
    expect(provider.continueTask).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/interrupted.*no provider turn was replayed/is),
    }));

    await stopRuntime(runtime);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import type { Client, TextChannel } from 'discord.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { createTaskRepository } from '../repositories/taskRepository.js';
import { createUsageRepository } from '../repositories/usageRepository.js';
import type { AgentProvider, ProviderAvailability } from '../agents/contracts.js';
import { DiscordTaskRenderer } from '../discord/taskRenderer.js';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
process.env.AUTHORIZED_USER_ID = 'owner';
process.env.CLAUDE_ENABLED = 'true';

const { getTaskCoordinator } = await import('./taskCoordinatorService.js');
const { getUsageAdmissionService } = await import('./usageAdmissionRegistry.js');
const { startRuntime, stopRuntime, resolvePrimaryAgentModel, createHostMcpProfiles } = await import('./runtime.js');

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-runtime-'));
  directories.push(directory);
  return directory;
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

describe('runtime startup', () => {
  it('builds default, disabled, and single-server MCP profiles from the host allowlist', () => {
    const servers = {
      browser: { type: 'stdio', command: 'browser-mcp' } as never,
      docs: { type: 'http', url: 'https://docs.example.test/mcp' } as never,
      default: { type: 'stdio', command: 'must-not-collide' } as never,
      disabled: { type: 'stdio', command: 'must-not-collide' } as never,
    };
    const profiles = createHostMcpProfiles(servers);

    expect(profiles.profiles).toEqual(['default', 'disabled', 'browser', 'docs']);
    expect(profiles.resolve()).toEqual({ browser: servers.browser, docs: servers.docs });
    expect(profiles.resolve('default')).toEqual({ browser: servers.browser, docs: servers.docs });
    expect(profiles.resolve('disabled')).toEqual({});
    expect(profiles.resolve('browser')).toEqual({ browser: servers.browser });
  });

  it('gives the persisted PM model precedence over provider defaults', () => {
    expect(resolvePrimaryAgentModel({
      persistedPrimaryModel: 'persisted-pm',
      configuredProviderModel: 'provider-default',
      configuredPrimaryModel: 'configured-pm',
    })).toBe('persisted-pm');
    expect(resolvePrimaryAgentModel({
      configuredProviderModel: 'provider-default',
      configuredPrimaryModel: 'configured-pm',
    })).toBe('provider-default');
  });

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

  it('disposes active task renderers during runtime shutdown', async () => {
    vi.useFakeTimers();
    const directory = tempDirectory();
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disablePrimaryAgent: true,
    });
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 1_000 });
    runtime.renderers.add(renderer);
    await renderer.start({ id: 'thread-1' } as never);
    await stopRuntime(runtime);
    vi.advanceTimersByTime(5_000);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
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

  it('posts provider onboarding in the PM channel before any provider is selected', async () => {
    const directory = tempDirectory();
    const send = vi.fn(async () => ({ id: 'setup-message' }));
    const agentChannel = {
      id: 'agent-chat',
      messages: { fetch: vi.fn(async () => null) },
      send,
    };
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
      channels: {
        cache: { find: () => undefined },
        create: vi.fn(async () => agentChannel),
      },
    };
    const client = { user: { id: 'bot-1' }, guilds: { fetch: vi.fn(async () => guild) } } as unknown as Client;
    const runtime = await startRuntime(client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disableCodex: true,
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/provider setup required/i) }));
    expect(runtime.settings.get('primary_channel_id')).toBe('agent-chat');
    expect(runtime.primaryAgent).toBeUndefined();

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
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('temporary Discord outage'))
      .mockRejectedValueOnce(new Error('temporary Discord outage'))
      .mockResolvedValue({ send } as unknown as TextChannel);
    const client = { channels: { fetch } } as unknown as Client;
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
    expect(fetch).toHaveBeenCalledTimes(3);

    await stopRuntime(runtime);
  });
});

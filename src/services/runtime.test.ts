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
const { activatePrimaryProvider } = await import('./agentRuntimeService.js');
const {
  startRuntime,
  stopRuntime,
  resolvePrimaryAgentModel,
  configuredPrimaryModelForProvider,
  createHostMcpProfiles,
} = await import('./runtime.js');

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

  it('uses the OpenCode-specific PM model without leaking it to other providers', () => {
    expect(configuredPrimaryModelForProvider({
      provider: 'opencode',
      primaryAgentModel: 'global-pm',
      openCodePrimaryModel: 'opencode-pm',
    })).toBe('opencode-pm');
    expect(configuredPrimaryModelForProvider({
      provider: 'codex',
      primaryAgentModel: 'global-pm',
      openCodePrimaryModel: 'opencode-pm',
    })).toBe('global-pm');
    expect(configuredPrimaryModelForProvider({
      provider: 'opencode',
      primaryAgentModel: 'global-pm',
    })).toBe('global-pm');
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

  it('runs and reconfigures the primary conversation service without a Discord gateway', async () => {
    const directory = tempDirectory();
    const codex = { ...fakeProvider(), id: 'codex' as const };
    const client = {
      guilds: { cache: new Map() },
      channels: { fetch: vi.fn() },
    } as unknown as Client;
    const runtime = await startRuntime(client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      codexProvider: codex,
      disableOpenCode: true,
      headlessPrimaryAgent: true,
      primaryProvider: 'claude',
      primaryModelFactory: provider => ({
        respond: async () => ({ reply: `${provider} ready` }),
      }),
    });

    const first = await runtime.conversationService!.process({
      conversationId: 'headless:primary',
      userId: 'owner',
      text: 'first turn',
    });
    expect(first).toEqual({ kind: 'reply', text: 'claude ready' });

    expect(await activatePrimaryProvider('codex')).toBe('reconfigured');
    const second = await runtime.conversationService!.process({
      conversationId: 'headless:primary',
      userId: 'owner',
      text: 'second turn',
    });
    expect(second).toEqual({ kind: 'reply', text: 'codex ready' });
    expect(runtime.messages.recent('headless:primary').map(entry => entry.role)).toEqual([
      'user', 'assistant', 'user', 'assistant',
    ]);
    expect(client.channels.fetch).not.toHaveBeenCalled();

    await stopRuntime(runtime);
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

    expect(runtime.providers.list()).toContain('codex');
    expect(runtime.providers.list()).not.toContain('claude');
    await stopRuntime(runtime);
  });

  it('registers injected OpenCode without starting the host CLI', async () => {
    const directory = tempDirectory();
    const openCode = { ...fakeProvider(), id: 'opencode' as const };
    const runtime = await startRuntime({} as Client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      openCodeProvider: openCode,
      disableClaude: true,
      disableCodex: true,
      disablePrimaryAgent: true,
    });

    expect(runtime.providers.list()).toContain('opencode');
    await stopRuntime(runtime);
  });

  it('records and exposes migration-backed repositories', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const projects = createProjectRepository(db);
    const tasks = createTaskRepository(db);
    const usage = createUsageRepository(db);

    expect(projects.listActive()).toEqual([]);
    expect(tasks.listActive()).toEqual([]);
    expect(usage.activeReservations()).toEqual([]);
    db.close();
  });

  it('supports renderer creation with Discord permission objects', async () => {
    const directory = tempDirectory();
    const guild = {
      members: { me: { permissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel]) } },
    };
    const client = {
      guilds: { cache: new Map([['test', guild]]) },
    } as unknown as Client;
    const runtime = await startRuntime(client, {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      claudeProvider: fakeProvider(),
      disablePrimaryAgent: true,
    });

    expect(runtime.renderers).toBeInstanceOf(Set);
    await stopRuntime(runtime);
  });
});

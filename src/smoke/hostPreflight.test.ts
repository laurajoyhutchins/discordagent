import { describe, expect, it } from 'vitest';
import {
  evaluateHostPreflight,
  formatPreflight,
  type CommandResult,
  type HostPreflightDependencies,
} from './hostPreflight.js';

function dependencies(overrides: Partial<HostPreflightDependencies> = {}): HostPreflightDependencies {
  const available: CommandResult = { ok: true, detail: 'available' };
  return {
    nodeVersion: '22.12.0',
    runCommand: () => available,
    ensureWritableDirectory: path => ({ ok: true, detail: path }),
    verifyDatabase: () => ({ ok: true, detail: '4 migrations applied in memory.' }),
    ...overrides,
  };
}

const validEnvironment: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: 'a-real-looking-token-value',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '223456789012345678',
  AUTHORIZED_ROLE_IDS: '323456789012345678,423456789012345678',
  AUTHORIZED_USER_ID: '523456789012345678',
  PROJECTS_BASE_DIR: '/projects',
  DATABASE_PATH: '/data/discordagent.sqlite',
  WORKTREES_BASE_DIR: '/worktrees',
  CODEX_ENABLED: 'true',
  PRIMARY_USAGE_RESERVE: '10',
};

describe('host preflight', () => {
  it('passes a complete host configuration', () => {
    const checks = evaluateHostPreflight(validEnvironment, dependencies());
    expect(checks.filter(check => check.status === 'fail')).toEqual([]);
    expect(formatPreflight(checks)).toContain('READY — 0 failure(s)');
  });

  it('fails placeholders, malformed Discord IDs, and unavailable required CLIs', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      DISCORD_TOKEN: 'your-bot-token-here',
      DISCORD_GUILD_ID: 'not-a-snowflake',
    }, dependencies({
      runCommand(command) {
        return command === 'codex'
          ? { ok: false, detail: 'command not found' }
          : { ok: true, detail: 'available' };
      },
    }));

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'DISCORD_TOKEN', status: 'fail' }),
      expect.objectContaining({ name: 'DISCORD_GUILD_ID format', status: 'fail' }),
      expect.objectContaining({ name: 'Codex CLI', status: 'fail' }),
    ]));
  });

  it('allows Codex and Roborev to be absent when they are disabled or optional', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      CODEX_ENABLED: 'false',
    }, dependencies({
      runCommand(command) {
        if (command === 'codex' || command === 'roborev') return { ok: false, detail: 'command not found' };
        return { ok: true, detail: 'available' };
      },
    }));

    expect(checks.find(check => check.name === 'Codex CLI')?.status).toBe('warn');
    expect(checks.find(check => check.name === 'Roborev CLI')?.status).toBe('warn');
    expect(checks.filter(check => check.status === 'fail')).toEqual([]);
  });
});

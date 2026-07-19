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
    verifyDatabase: () => ({ ok: true, detail: '9 migrations applied in memory.' }),
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
  CLAUDE_ENABLED: 'true',
  CODEX_ENABLED: 'true',
  OPENCODE_ENABLED: 'true',
  PRIMARY_USAGE_RESERVE: '10',
};

function providerCheck(
  checks: ReturnType<typeof evaluateHostPreflight>,
  name: 'Claude provider' | 'Codex provider' | 'OpenCode provider' | 'Provider readiness',
) {
  return checks.find(check => check.name === name);
}

describe('host preflight', () => {
  it('passes a complete host configuration with multiple available providers', () => {
    const checks = evaluateHostPreflight(validEnvironment, dependencies());

    expect(providerCheck(checks, 'Provider readiness')).toEqual(expect.objectContaining({
      status: 'pass',
      detail: expect.stringMatching(/3 enabled provider.*available/i),
    }));
    expect(checks.filter(check => check.status === 'fail')).toEqual([]);
    expect(formatPreflight(checks)).toContain('READY — 0 failure(s)');
  });

  it.each([
    ['Claude', 'claude'],
    ['Codex', 'codex'],
    ['OpenCode', 'opencode'],
  ] as const)('reports READY when only %s is available', (displayName, availableCommand) => {
    const checks = evaluateHostPreflight(validEnvironment, dependencies({
      runCommand(command) {
        if (command === 'git' || command === 'roborev' || command === availableCommand) {
          return { ok: true, detail: 'available' };
        }
        return { ok: false, detail: 'command not found' };
      },
    }));

    expect(providerCheck(checks, 'Provider readiness')).toEqual(expect.objectContaining({
      status: 'pass',
      detail: expect.stringContaining(displayName),
    }));
    expect(checks.filter(check => check.status === 'fail')).toEqual([]);
    expect(checks.filter(check => check.status === 'warn').map(check => check.name)).toEqual(
      expect.arrayContaining([
        ...(['Claude', 'Codex', 'OpenCode'] as const)
          .filter(name => name !== displayName)
          .map(name => `${name} provider`),
      ]),
    );
  });

  it('reports NOT READY when no enabled provider is available', () => {
    const checks = evaluateHostPreflight(validEnvironment, dependencies({
      runCommand(command) {
        return command === 'git' || command === 'roborev'
          ? { ok: true, detail: 'available' }
          : { ok: false, detail: 'command not found' };
      },
    }));

    expect(providerCheck(checks, 'Claude provider')?.status).toBe('warn');
    expect(providerCheck(checks, 'Codex provider')?.status).toBe('warn');
    expect(providerCheck(checks, 'OpenCode provider')?.status).toBe('warn');
    expect(providerCheck(checks, 'Provider readiness')).toEqual(expect.objectContaining({
      status: 'fail',
      detail: expect.stringMatching(/no enabled provider is available/i),
    }));
    expect(formatPreflight(checks)).toContain('NOT READY');
  });

  it('does not probe disabled providers and reports them consistently', () => {
    const commands: string[] = [];
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      CODEX_ENABLED: 'false',
      OPENCODE_ENABLED: 'false',
    }, dependencies({
      runCommand(command) {
        commands.push(command);
        return { ok: true, detail: 'available' };
      },
    }));

    expect(commands).not.toContain('codex');
    expect(commands).not.toContain('opencode');
    expect(providerCheck(checks, 'Codex provider')).toEqual(expect.objectContaining({
      status: 'pass',
      detail: expect.stringMatching(/disabled.*CODEX_ENABLED=false/i),
    }));
    expect(providerCheck(checks, 'OpenCode provider')).toEqual(expect.objectContaining({
      status: 'pass',
      detail: expect.stringMatching(/disabled.*OPENCODE_ENABLED=false/i),
    }));
    expect(providerCheck(checks, 'Provider readiness')?.status).toBe('pass');
  });

  it('fails when an explicitly required provider is unavailable despite another provider being available', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      REQUIRED_PROVIDERS: 'codex',
    }, dependencies({
      runCommand(command) {
        return command === 'codex'
          ? { ok: false, detail: 'command not found' }
          : { ok: true, detail: 'available' };
      },
    }));

    expect(providerCheck(checks, 'Claude provider')?.status).toBe('pass');
    expect(providerCheck(checks, 'Codex provider')).toEqual(expect.objectContaining({
      status: 'fail',
      detail: expect.stringMatching(/required.*command not found.*install.*disable/i),
    }));
  });

  it('fails when an explicitly required provider is disabled', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      CODEX_ENABLED: 'false',
      REQUIRED_PROVIDERS: 'codex',
    }, dependencies());

    expect(providerCheck(checks, 'Codex provider')).toEqual(expect.objectContaining({
      status: 'fail',
      detail: expect.stringMatching(/required.*disabled.*CODEX_ENABLED/i),
    }));
  });

  it('fails an invalid required-provider configuration without probing an unknown command', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      REQUIRED_PROVIDERS: 'codex,unknown',
    }, dependencies());

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Required providers',
        status: 'fail',
        detail: expect.stringMatching(/unknown.*REQUIRED_PROVIDERS/i),
      }),
    ]));
  });

  it('treats a reported unauthenticated provider as unavailable for readiness', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      CLAUDE_ENABLED: 'false',
      OPENCODE_ENABLED: 'false',
    }, dependencies({
      runCommand(command) {
        if (command === 'codex') {
          return {
            ok: true,
            detail: 'Codex installed',
            authentication: 'unauthenticated',
          };
        }
        return { ok: true, detail: 'available' };
      },
    }));

    expect(providerCheck(checks, 'Codex provider')).toEqual(expect.objectContaining({
      status: 'warn',
      detail: expect.stringMatching(/authentication required/i),
    }));
    expect(providerCheck(checks, 'Provider readiness')?.status).toBe('fail');
  });

  it('fails placeholders and malformed Discord IDs independently of provider degradation', () => {
    const checks = evaluateHostPreflight({
      ...validEnvironment,
      DISCORD_TOKEN: 'your-bot-token-here',
      DISCORD_GUILD_ID: 'not-a-snowflake',
    }, dependencies());

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'DISCORD_TOKEN', status: 'fail' }),
      expect.objectContaining({ name: 'DISCORD_GUILD_ID format', status: 'fail' }),
    ]));
  });

  it('keeps optional Roborev absence as a warning', () => {
    const checks = evaluateHostPreflight(validEnvironment, dependencies({
      runCommand(command) {
        return command === 'roborev'
          ? { ok: false, detail: 'command not found' }
          : { ok: true, detail: 'available' };
      },
    }));

    expect(checks.find(check => check.name === 'Roborev CLI')?.status).toBe('warn');
    expect(checks.filter(check => check.status === 'fail')).toEqual([]);
  });
});

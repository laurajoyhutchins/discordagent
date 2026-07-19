import 'dotenv/config';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { AgentProviderId } from '../agents/contracts.js';
import {
  resolveProviderHostConfiguration,
  resolveRequiredProviderIds,
} from '../agents/providerConfiguration.js';
import { buildProcessInvocation } from '../utils/processInvocation.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { resolveApplicationPaths } from '../utils/applicationPaths.js';

export type PreflightStatus = 'pass' | 'warn' | 'fail';
export type ProviderAuthenticationStatus = 'authenticated' | 'unauthenticated' | 'unknown';

export interface PreflightCheck {
  readonly name: string;
  readonly status: PreflightStatus;
  readonly detail: string;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly detail: string;
  readonly authentication?: ProviderAuthenticationStatus;
}

export interface HostPreflightDependencies {
  readonly nodeVersion: string;
  runCommand(command: string, args: readonly string[]): CommandResult;
  ensureWritableDirectory(path: string): CommandResult;
  verifyDatabase(): CommandResult;
}

const SNOWFLAKE = /^\d{17,20}$/;
const PLACEHOLDER = /(your-|replace|example|changeme|token-here)/i;

function pass(name: string, detail: string): PreflightCheck {
  return { name, status: 'pass', detail };
}

function warn(name: string, detail: string): PreflightCheck {
  return { name, status: 'warn', detail };
}

function fail(name: string, detail: string): PreflightCheck {
  return { name, status: 'fail', detail };
}

function requiredValue(
  env: NodeJS.ProcessEnv,
  key: string,
  checks: PreflightCheck[],
): string | undefined {
  const value = env[key]?.trim();
  if (!value) {
    checks.push(fail(key, 'Missing required environment variable.'));
    return undefined;
  }
  if (PLACEHOLDER.test(value)) {
    checks.push(fail(key, 'Still contains an example or placeholder value.'));
    return undefined;
  }
  checks.push(pass(key, 'Configured.'));
  return value;
}

function validateSnowflake(name: string, value: string | undefined, checks: PreflightCheck[]): void {
  if (!value) return;
  if (SNOWFLAKE.test(value)) checks.push(pass(`${name} format`, 'Valid Discord snowflake format.'));
  else checks.push(fail(`${name} format`, 'Expected a 17–20 digit Discord snowflake.'));
}

export function createHostPreflightDependencies(): HostPreflightDependencies {
  return {
    nodeVersion: process.versions.node,
    runCommand(command, args) {
      const invocation = buildProcessInvocation(command, args);
      const result = spawnSync(invocation.command, [...invocation.args], {
        encoding: 'utf8',
        shell: false,
        timeout: 15_000,
      });
      if (result.error) return { ok: false, detail: result.error.message };
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || `exit status ${String(result.status)}`).trim();
        return { ok: false, detail };
      }
      return {
        ok: true,
        detail: (result.stdout || result.stderr || 'available').trim().split('\n')[0]!,
        authentication: 'unknown',
      };
    },
    ensureWritableDirectory(path) {
      try {
        mkdirSync(path, { recursive: true });
        accessSync(path, constants.R_OK | constants.W_OK);
        return { ok: true, detail: resolve(path) };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    verifyDatabase() {
      try {
        const database = openDatabase(':memory:');
        runMigrations(database);
        const versions = database.raw
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all() as Array<{ version: number }>;
        database.close();
        return { ok: true, detail: `${versions.length} migration(s) applied in memory.` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function evaluateProviders(
  env: NodeJS.ProcessEnv,
  dependencies: HostPreflightDependencies,
  checks: PreflightCheck[],
): void {
  let requiredProviders = new Set<AgentProviderId>();
  try {
    const resolved = resolveRequiredProviderIds(env);
    requiredProviders = new Set(resolved);
    checks.push(pass(
      'Required providers',
      resolved.length > 0 ? resolved.join(', ') : 'None explicitly required.',
    ));
  } catch (error) {
    checks.push(fail('Required providers', error instanceof Error ? error.message : String(error)));
  }

  const providers = resolveProviderHostConfiguration(env);
  const availableProviders: string[] = [];
  const enabledProviders = providers.filter(provider => provider.enabled);

  for (const provider of providers) {
    const name = `${provider.displayName} provider`;
    const required = requiredProviders.has(provider.id);

    if (!provider.enabled) {
      checks.push(required
        ? fail(
          name,
          `Required provider is disabled by ${provider.enabledEnv}=false. `
          + `Enable it or remove it from REQUIRED_PROVIDERS.`,
        )
        : pass(name, `Disabled by ${provider.enabledEnv}=false.`));
      continue;
    }

    const result = dependencies.runCommand(provider.command, provider.versionArgs);
    const authentication = result.authentication ?? 'unknown';
    const available = result.ok && authentication !== 'unauthenticated';

    if (available) {
      availableProviders.push(provider.displayName);
      checks.push(pass(
        name,
        authentication === 'authenticated'
          ? `${result.detail}; authenticated.`
          : `${result.detail}; authentication not verified by smoke:host.`,
      ));
      continue;
    }

    const unavailableDetail = authentication === 'unauthenticated'
      ? `${result.detail}; authentication required.`
      : result.detail;
    checks.push(required
      ? fail(
        name,
        `Required provider unavailable: ${unavailableDetail} `
        + `Install or authenticate ${provider.displayName}, or disable it with `
        + `${provider.enabledEnv}=false only after removing it from REQUIRED_PROVIDERS.`,
      )
      : warn(
        name,
        `${unavailableDetail} Install or authenticate ${provider.displayName}, `
        + `or disable it with ${provider.enabledEnv}=false.`,
      ));
  }

  if (availableProviders.length === 0) {
    checks.push(fail(
      'Provider readiness',
      'No enabled provider is available. Install or authenticate at least one enabled provider, '
      + 'or enable a provider that is already installed.',
    ));
  } else if (availableProviders.length === enabledProviders.length) {
    checks.push(pass(
      'Provider readiness',
      `${enabledProviders.length} enabled provider${enabledProviders.length === 1 ? '' : 's'} `
      + `are available: ${availableProviders.join(', ')}.`,
    ));
  } else {
    checks.push(pass(
      'Provider readiness',
      `${availableProviders.length} of ${enabledProviders.length} enabled providers available: `
      + `${availableProviders.join(', ')}.`,
    ));
  }
}

export function evaluateHostPreflight(
  env: NodeJS.ProcessEnv,
  dependencies: HostPreflightDependencies,
): readonly PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  const major = Number.parseInt(dependencies.nodeVersion.split('.')[0] ?? '', 10);
  checks.push(Number.isFinite(major) && major >= 22
    ? pass('Node.js', `v${dependencies.nodeVersion}`)
    : fail('Node.js', `Node.js 22 or newer is required; found v${dependencies.nodeVersion}.`));

  requiredValue(env, 'DISCORD_TOKEN', checks);
  const clientId = requiredValue(env, 'DISCORD_CLIENT_ID', checks);
  const guildId = requiredValue(env, 'DISCORD_GUILD_ID', checks);
  const roleList = requiredValue(env, 'AUTHORIZED_ROLE_IDS', checks);
  validateSnowflake('DISCORD_CLIENT_ID', clientId, checks);
  validateSnowflake('DISCORD_GUILD_ID', guildId, checks);

  if (roleList) {
    const roles = roleList.split(',').map(value => value.trim()).filter(Boolean);
    if (roles.length === 0 || roles.some(role => !SNOWFLAKE.test(role))) {
      checks.push(fail('AUTHORIZED_ROLE_IDS format', 'Each role must be a 17–20 digit Discord snowflake.'));
    } else {
      checks.push(pass('AUTHORIZED_ROLE_IDS format', `${roles.length} authorized role(s) configured.`));
    }
  }

  const ownerId = env.AUTHORIZED_USER_ID?.trim() || env.NOTIFY_USER_ID?.trim();
  if (!ownerId) {
    checks.push(warn('Primary-agent owner', 'AUTHORIZED_USER_ID and NOTIFY_USER_ID are both empty; owner-only provider authentication and #agent-chat are disabled.'));
  } else if (!SNOWFLAKE.test(ownerId)) {
    checks.push(fail('Primary-agent owner', 'AUTHORIZED_USER_ID/NOTIFY_USER_ID must be a Discord snowflake.'));
  } else {
    checks.push(pass('Primary-agent owner', 'Owner identity configured.'));
  }

  const projectsBaseDir = env.PROJECTS_BASE_DIR?.trim();
  if (!projectsBaseDir) {
    checks.push(warn('Project path boundary', 'PROJECTS_BASE_DIR is empty; registered repositories are not restricted to one parent directory.'));
  } else {
    const result = dependencies.ensureWritableDirectory(projectsBaseDir);
    checks.push(result.ok
      ? pass('Project path boundary', result.detail)
      : fail('Project path boundary', result.detail));
  }

  try {
    const applicationPaths = resolveApplicationPaths({ env });
    checks.push(applicationPaths.notice
      ? warn('Application data', applicationPaths.notice)
      : pass('Application data', applicationPaths.dataRoot));

    const databaseDirectory = dependencies.ensureWritableDirectory(dirname(applicationPaths.databasePath));
    checks.push(databaseDirectory.ok
      ? pass('Database directory', databaseDirectory.detail)
      : fail('Database directory', databaseDirectory.detail));

    const worktreesDirectory = dependencies.ensureWritableDirectory(applicationPaths.worktreesBaseDir);
    checks.push(worktreesDirectory.ok
      ? pass('Worktree directory', worktreesDirectory.detail)
      : fail('Worktree directory', worktreesDirectory.detail));
  } catch (error) {
    checks.push(fail('Application data', error instanceof Error ? error.message : String(error)));
  }

  const git = dependencies.runCommand('git', ['--version']);
  checks.push(git.ok ? pass('Git CLI', git.detail) : fail('Git CLI', git.detail));

  evaluateProviders(env, dependencies, checks);

  const roborev = dependencies.runCommand(
    env.ROBOREV_CLI_PATH?.trim() || 'roborev',
    ['version'],
  );
  checks.push(roborev.ok
    ? pass('Roborev CLI', roborev.detail)
    : warn('Roborev CLI', `${roborev.detail} (optional)`));

  const database = dependencies.verifyDatabase();
  checks.push(database.ok
    ? pass('SQLite migrations', database.detail)
    : fail('SQLite migrations', database.detail));

  const reserve = Number.parseFloat(env.PRIMARY_USAGE_RESERVE ?? '10');
  checks.push(Number.isFinite(reserve) && reserve >= 0 && reserve <= 100
    ? pass('Primary usage reserve', `${reserve}%`)
    : fail('Primary usage reserve', 'PRIMARY_USAGE_RESERVE must be between 0 and 100.'));

  return checks;
}

export function formatPreflight(checks: readonly PreflightCheck[]): string {
  const symbol: Record<PreflightStatus, string> = { pass: '✓', warn: '!', fail: '✗' };
  const lines = checks.map(check => `${symbol[check.status]} ${check.name}: ${check.detail}`);
  const failures = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warn').length;
  lines.push('', `${failures === 0 ? 'READY' : 'NOT READY'} — ${failures} failure(s), ${warnings} warning(s).`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const checks = evaluateHostPreflight(process.env, createHostPreflightDependencies());
  console.log(formatPreflight(checks));
  if (checks.some(check => check.status === 'fail')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

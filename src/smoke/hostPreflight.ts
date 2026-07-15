import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  readonly name: string;
  readonly status: PreflightStatus;
  readonly detail: string;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly detail: string;
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
      const result = spawnSync(command, [...args], {
        encoding: 'utf8',
        shell: false,
        timeout: 15_000,
      });
      if (result.error) return { ok: false, detail: result.error.message };
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || `exit status ${String(result.status)}`).trim();
        return { ok: false, detail };
      }
      return { ok: true, detail: (result.stdout || result.stderr || 'available').trim().split('\n')[0]! };
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
    checks.push(warn('Primary-agent owner', 'AUTHORIZED_USER_ID and NOTIFY_USER_ID are both empty; owner-only Codex authentication and #agent-chat are disabled.'));
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

  const databasePath = env.DATABASE_PATH?.trim() || resolve('src/data/discordagent.sqlite');
  const databaseDirectory = dependencies.ensureWritableDirectory(dirname(databasePath));
  checks.push(databaseDirectory.ok
    ? pass('Database directory', databaseDirectory.detail)
    : fail('Database directory', databaseDirectory.detail));

  const worktreesPath = env.WORKTREES_BASE_DIR?.trim() || resolve(dirname(databasePath), 'discordagent-worktrees');
  const worktreesDirectory = dependencies.ensureWritableDirectory(worktreesPath);
  checks.push(worktreesDirectory.ok
    ? pass('Worktree directory', worktreesDirectory.detail)
    : fail('Worktree directory', worktreesDirectory.detail));

  for (const [name, command, args, required] of [
    ['Git CLI', 'git', ['--version'], true],
    ['Claude CLI', 'claude', ['--version'], true],
    ['Codex CLI', env.CODEX_CLI_PATH?.trim() || 'codex', ['--version'], env.CODEX_ENABLED !== 'false'],
    ['Roborev CLI', env.ROBOREV_CLI_PATH?.trim() || 'roborev', ['version'], false],
  ] as const) {
    const result = dependencies.runCommand(command, args);
    checks.push(result.ok
      ? pass(name, result.detail)
      : required
        ? fail(name, result.detail)
        : warn(name, `${result.detail} (optional)`));
  }

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

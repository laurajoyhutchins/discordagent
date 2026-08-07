import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  VERIFIED_CODEX_CLI_VERSION,
  evaluateCodexCliVersion,
} from '../agents/codex/codexCompatibility.js';
import { buildProcessInvocation } from '../utils/processInvocation.js';

export interface CodexVersionCheck {
  readonly status: 'pass' | 'skip' | 'fail';
  readonly detail: string;
}

export function checkCodexVersion(
  env: NodeJS.ProcessEnv = process.env,
  runVersion: (command: string) => { readonly ok: boolean; readonly detail: string } = command => {
    const invocation = buildProcessInvocation(command, ['--version']);
    const result = spawnSync(invocation.command, [...invocation.args], {
      encoding: 'utf8',
      shell: false,
      timeout: 15_000,
    });
    if (result.error) return { ok: false, detail: result.error.message };
    if (result.status !== 0) {
      return {
        ok: false,
        detail: (result.stderr || result.stdout || `exit status ${String(result.status)}`).trim(),
      };
    }
    return { ok: true, detail: (result.stdout || result.stderr || '').trim() };
  },
): CodexVersionCheck {
  if (env.CODEX_ENABLED === 'false') {
    return { status: 'skip', detail: 'Codex provider disabled by CODEX_ENABLED=false.' };
  }

  const command = env.CODEX_CLI_PATH?.trim() || 'codex';
  const result = runVersion(command);
  if (!result.ok) {
    return { status: 'fail', detail: `Unable to establish Codex CLI version: ${result.detail}` };
  }

  const compatibility = evaluateCodexCliVersion(result.detail);
  if (!compatibility.compatible) {
    const detected = compatibility.detectedVersion ?? 'unparseable';
    return {
      status: 'fail',
      detail: `Codex CLI ${detected} is not the verified production version ${compatibility.expectedVersion}.`,
    };
  }

  return {
    status: 'pass',
    detail: `Codex CLI ${VERIFIED_CODEX_CLI_VERSION} matches the verified production version.`,
  };
}

async function main(): Promise<void> {
  const result = checkCodexVersion();
  const symbol = result.status === 'pass' ? '✓' : result.status === 'skip' ? '-' : '✗';
  console.log(`${symbol} Codex compatibility: ${result.detail}`);
  if (result.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

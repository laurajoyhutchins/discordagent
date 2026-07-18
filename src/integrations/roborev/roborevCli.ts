import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { buildProcessInvocation } from '../../utils/processInvocation.js';

const execFileAsync = promisify(execFile);

export function spawnStream(cliPath: string): ChildProcess {
  const invocation = buildProcessInvocation(cliPath, ['stream']);
  return spawn(invocation.command, invocation.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, CLAUDECODE: '' },
  });
}

export async function fetchReviewBody(cliPath: string, jobId: number): Promise<string> {
  try {
    const invocation = buildProcessInvocation(cliPath, ['show', String(jobId)]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, CLAUDECODE: '' },
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function isCliAvailable(cliPath: string): Promise<boolean> {
  try {
    const invocation = buildProcessInvocation(cliPath, ['version']);
    await execFileAsync(invocation.command, invocation.args, {
      timeout: 5000,
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

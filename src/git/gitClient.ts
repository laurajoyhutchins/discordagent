import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export interface GitClient {
  run(cwd: string, args: readonly string[]): Promise<GitResult>;
}

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly cwd: string,
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export function createGitClient(): GitClient {
  return {
    async run(cwd: string, args: readonly string[]): Promise<GitResult> {
      try {
        const result = await execFileAsync('git', [...args], {
          cwd,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          shell: false,
        });
        return {
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
        };
      } catch (error) {
        const candidate = error as Error & { stderr?: string | Buffer };
        const stderr = typeof candidate.stderr === 'string'
          ? candidate.stderr.trim()
          : candidate.stderr?.toString('utf8').trim() ?? '';
        const command = ['git', ...args].join(' ');
        throw new GitCommandError(
          stderr || `Git command failed: ${command}`,
          cwd,
          args,
          stderr,
        );
      }
    },
  };
}

import { describe, expect, it } from 'vitest';
import { buildProcessInvocation } from './processInvocation.js';

describe('buildProcessInvocation', () => {
  it('runs Windows command shims through ComSpec without enabling Node shell mode', () => {
    expect(buildProcessInvocation('C:\\Program Files\\Tools\\codex.cmd', ['app-server'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program Files\\Tools\\codex.cmd" app-server'],
    });
  });

  it('leaves normal executables unchanged', () => {
    expect(buildProcessInvocation('codex', ['--version'], 'win32')).toEqual({ command: 'codex', args: ['--version'] });
    expect(buildProcessInvocation('codex.cmd', ['--version'], 'linux')).toEqual({ command: 'codex.cmd', args: ['--version'] });
  });
});

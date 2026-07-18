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
    expect(buildProcessInvocation('codex.exe', ['--version'], 'win32', 'cmd.exe')).toEqual({ command: 'codex.exe', args: ['--version'] });
    expect(buildProcessInvocation('C:\\Tools\\codex', ['--version'], 'win32', 'cmd.exe')).toEqual({ command: 'C:\\Tools\\codex', args: ['--version'] });
    expect(buildProcessInvocation('codex.cmd', ['--version'], 'linux', 'cmd.exe')).toEqual({ command: 'codex.cmd', args: ['--version'] });
  });

  it('wraps bare command names in ComSpec on Windows for PATH resolution', () => {
    expect(buildProcessInvocation('codex', ['--version'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex --version'],
    });
    expect(buildProcessInvocation('opencode', ['acp'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'opencode acp'],
    });
  });

  it('quotes args with special characters when wrapping in ComSpec on Windows', () => {
    const result = buildProcessInvocation('opencode', ['--model', 'claude-sonnet-4-6', 'acp'], 'win32', 'cmd.exe');
    expect(result.command).toBe('cmd.exe');
    expect(result.args[3]).toContain('opencode');
    expect(result.args[3]).toContain('--model');
    expect(result.args[3]).toContain('claude-sonnet-4-6');
    expect(result.args[3]).toContain('acp');
  });
});

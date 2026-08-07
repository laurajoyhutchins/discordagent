import { describe, expect, it } from 'vitest';
import { checkCodexVersion } from './codexVersion.js';

describe('Codex host compatibility smoke', () => {
  it('passes only the verified production version', () => {
    expect(checkCodexVersion({}, () => ({ ok: true, detail: 'codex-cli 0.145.0' }))).toEqual({
      status: 'pass',
      detail: 'Codex CLI 0.145.0 matches the verified production version.',
    });
  });

  it('fails closed when an enabled Codex CLI has drifted', () => {
    expect(checkCodexVersion({}, () => ({ ok: true, detail: 'codex-cli 0.146.0' }))).toEqual({
      status: 'fail',
      detail: 'Codex CLI 0.146.0 is not the verified production version 0.145.0.',
    });
  });

  it('fails closed when the installed version cannot be established', () => {
    expect(checkCodexVersion({}, () => ({ ok: false, detail: 'command not found' }))).toEqual({
      status: 'fail',
      detail: 'Unable to establish Codex CLI version: command not found',
    });
  });

  it('does not require Codex when the provider is explicitly disabled', () => {
    let invoked = false;
    const result = checkCodexVersion({ CODEX_ENABLED: 'false' }, () => {
      invoked = true;
      return { ok: false, detail: 'should not run' };
    });

    expect(invoked).toBe(false);
    expect(result.status).toBe('skip');
  });

  it('uses the configured Codex CLI path', () => {
    const commands: string[] = [];
    checkCodexVersion({ CODEX_CLI_PATH: '/opt/codex' }, command => {
      commands.push(command);
      return { ok: true, detail: 'codex-cli 0.145.0' };
    });

    expect(commands).toEqual(['/opt/codex']);
  });
});

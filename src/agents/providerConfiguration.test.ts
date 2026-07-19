import { describe, expect, it } from 'vitest';
import {
  resolveProviderHostConfiguration,
  resolveRequiredProviderIds,
} from './providerConfiguration.js';

describe('provider host configuration', () => {
  it('enables every provider by default with runtime CLI defaults', () => {
    expect(resolveProviderHostConfiguration({})).toEqual([
      {
        id: 'claude',
        displayName: 'Claude',
        enabled: true,
        enabledEnv: 'CLAUDE_ENABLED',
        command: 'claude',
        versionArgs: ['--version'],
      },
      {
        id: 'codex',
        displayName: 'Codex',
        enabled: true,
        enabledEnv: 'CODEX_ENABLED',
        command: 'codex',
        versionArgs: ['--version'],
      },
      {
        id: 'opencode',
        displayName: 'OpenCode',
        enabled: true,
        enabledEnv: 'OPENCODE_ENABLED',
        command: 'opencode',
        versionArgs: ['--version'],
      },
    ]);
  });

  it('preserves existing false-only enablement semantics and CLI overrides', () => {
    expect(resolveProviderHostConfiguration({
      CLAUDE_ENABLED: 'false',
      CODEX_ENABLED: 'true',
      OPENCODE_ENABLED: 'false',
      CODEX_CLI_PATH: '/opt/codex',
      OPENCODE_CLI_PATH: '/opt/opencode',
    })).toEqual([
      expect.objectContaining({ id: 'claude', enabled: false, command: 'claude' }),
      expect.objectContaining({ id: 'codex', enabled: true, command: '/opt/codex' }),
      expect.objectContaining({ id: 'opencode', enabled: false, command: '/opt/opencode' }),
    ]);
  });

  it('parses, normalizes, and deduplicates explicitly required providers', () => {
    expect(resolveRequiredProviderIds({
      REQUIRED_PROVIDERS: ' Codex,claude,CODEX ',
    })).toEqual(['codex', 'claude']);
  });

  it('rejects unknown explicitly required providers', () => {
    expect(() => resolveRequiredProviderIds({ REQUIRED_PROVIDERS: 'codex,unknown' }))
      .toThrow(/unknown.*REQUIRED_PROVIDERS.*claude.*codex.*opencode/i);
  });
});

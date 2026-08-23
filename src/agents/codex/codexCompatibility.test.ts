import { describe, expect, it } from 'vitest';
import {
  VERIFIED_CODEX_CLI_VERSION,
  evaluateCodexCliVersion,
} from './codexCompatibility.js';

describe('Codex CLI compatibility', () => {
  it('accepts the exact CLI version proven by the native ARM64 canary', () => {
    expect(evaluateCodexCliVersion(`codex-cli ${VERIFIED_CODEX_CLI_VERSION}`)).toEqual({
      compatible: true,
      detectedVersion: VERIFIED_CODEX_CLI_VERSION,
      expectedVersion: VERIFIED_CODEX_CLI_VERSION,
    });
  });

  it('rejects a different installed Codex version instead of silently treating it as compatible', () => {
    expect(evaluateCodexCliVersion('codex-cli 0.146.0')).toEqual({
      compatible: false,
      detectedVersion: '0.146.0',
      expectedVersion: VERIFIED_CODEX_CLI_VERSION,
    });
  });

  it('rejects version output that cannot establish the installed version', () => {
    expect(evaluateCodexCliVersion('codex-cli available')).toEqual({
      compatible: false,
      detectedVersion: null,
      expectedVersion: VERIFIED_CODEX_CLI_VERSION,
    });
  });
});

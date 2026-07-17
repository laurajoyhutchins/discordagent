import { describe, expect, it } from 'vitest';
import {
  validateClaudeTimeout,
  validateModelOverride,
  validateMcpProfile,
  validateUsageReserve,
} from './validation.js';

describe('agent settings validation', () => {
  it('accepts Claude timeouts within the inclusive range', () => {
    expect(validateClaudeTimeout(60_000)).toBe(60_000);
    expect(() => validateClaudeTimeout(0)).toThrow(/timeout/i);
    expect(() => validateClaudeTimeout(3_600_001)).toThrow(/timeout/i);
  });

  it('accepts usage reserves from zero through fifty percent', () => {
    expect(validateUsageReserve(25)).toBe(25);
    expect(() => validateUsageReserve(-1)).toThrow(/reserve/i);
    expect(() => validateUsageReserve(51)).toThrow(/reserve/i);
  });

  it('normalizes model overrides so blank values clear the override', () => {
    expect(validateModelOverride('gpt-5-codex')).toBe('gpt-5-codex');
    expect(validateModelOverride('   ')).toBeUndefined();
  });

  it('accepts only MCP profiles from the supplied catalog', () => {
    expect(validateMcpProfile('browser', ['default', 'browser'])).toBe('browser');
    expect(() => validateMcpProfile('unknown', ['default'])).toThrow(/profile/i);
  });
});

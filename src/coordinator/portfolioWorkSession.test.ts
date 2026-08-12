import { describe, expect, it } from 'vitest';
import { applyBoundedCapabilityProfile } from './portfolioWorkSession.js';

describe('bounded portfolio capability profile', () => {
  it('adds one named MCP profile to the durable task settings', () => {
    expect(applyBoundedCapabilityProfile({
      provider: 'claude',
      requestedProfile: 'linear',
      availableProfiles: ['default', 'disabled', 'github', 'linear', 'drive'],
      settings: { model: 'sonnet', timeoutMs: 30_000 },
    })).toEqual({
      model: 'sonnet',
      timeoutMs: 30_000,
      mcpProfile: 'linear',
    });
  });

  it.each(['default', 'disabled'])('rejects the broad or non-capability profile %s', profile => {
    expect(() => applyBoundedCapabilityProfile({
      provider: 'claude',
      requestedProfile: profile,
      availableProfiles: ['default', 'disabled', 'linear'],
      settings: {},
    })).toThrow(/bounded capability profile/i);
  });

  it('rejects profiles that are not present in the live host catalog', () => {
    expect(() => applyBoundedCapabilityProfile({
      provider: 'claude',
      requestedProfile: 'linear-admin',
      availableProfiles: ['default', 'disabled', 'linear'],
      settings: {},
    })).toThrow(/not available/i);
  });

  it('fails closed when the selected provider cannot accept MCP profiles', () => {
    expect(() => applyBoundedCapabilityProfile({
      provider: 'codex',
      requestedProfile: 'linear',
      availableProfiles: ['linear'],
      settings: {},
    })).toThrow(/does not support/i);
  });
});

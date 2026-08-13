import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    claudeEnabled: false,
    codexEnabled: false,
    openCodeEnabled: false,
    mcpServers: undefined,
  },
}));

import { createHostMcpProfiles } from '../services/runtimeProviders.js';
import {
  FAST_FORWARD_CAPABILITY_PROFILE,
  buildFastForwardWorkSessionPrompt,
  fastForwardCapabilityProfiles,
} from './portfolioWorkSession.js';

describe('Fast Forward portfolio work session', () => {
  it('exposes one least-privilege composite profile for the three authoritative services', () => {
    const github = { type: 'http', url: 'https://github.example.test/mcp' } as never;
    const linear = { type: 'http', url: 'https://linear.example.test/mcp' } as never;
    const drive = { type: 'http', url: 'https://drive.example.test/mcp' } as never;
    const browser = { type: 'stdio', command: 'browser-mcp' } as never;
    const profiles = createHostMcpProfiles({ github, linear, drive, browser });

    expect(profiles.profiles).toContain(FAST_FORWARD_CAPABILITY_PROFILE);
    expect(profiles.resolve(FAST_FORWARD_CAPABILITY_PROFILE)).toEqual({ github, linear, drive });
    expect(profiles.resolve(FAST_FORWARD_CAPABILITY_PROFILE)).not.toHaveProperty('browser');
    expect(fastForwardCapabilityProfiles(profiles.profiles)).toEqual([FAST_FORWARD_CAPABILITY_PROFILE]);
  });

  it('fails closed when any Fast Forward authority is missing from the live host catalog', () => {
    const github = { type: 'http', url: 'https://github.example.test/mcp' } as never;
    const linear = { type: 'http', url: 'https://linear.example.test/mcp' } as never;
    const profiles = createHostMcpProfiles({ github, linear });

    expect(profiles.profiles).not.toContain(FAST_FORWARD_CAPABILITY_PROFILE);
    expect(profiles.resolve(FAST_FORWARD_CAPABILITY_PROFILE)).toBeUndefined();
    expect(fastForwardCapabilityProfiles(profiles.profiles)).toEqual([]);
  });

  it('persists a session token and points the worker at live Drive skills instead of copying the procedure', () => {
    const prompt = buildFastForwardWorkSessionPrompt({
      objective: 'Fast forward the current execution queue.',
      sessionToken: 'ff-test123',
    });

    expect(prompt).toContain('ff-test123');
    expect(prompt).toContain('FAST-FORWARD.SKILL.md');
    expect(prompt).toContain('EXECUTION-OWNERSHIP.SKILL.md');
    expect(prompt).toContain('gate-specific');
    expect(prompt).toContain('Fast forward the current execution queue.');
    expect(prompt).not.toContain('FF_CLAIM');
    expect(prompt).not.toContain('FF_RELEASE');
  });
});

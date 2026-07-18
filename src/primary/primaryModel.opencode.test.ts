import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AgentProviderId } from '../agents/contracts.js';
import { buildPrimaryPrompt, type PrimaryTaskProposal } from './primaryModel.js';

describe('primary model OpenCode contract', () => {
  it('allows OpenCode task proposals in both types and the structured prompt schema', () => {
    expectTypeOf<PrimaryTaskProposal['provider']>().toEqualTypeOf<AgentProviderId | undefined>();

    const prompt = buildPrimaryPrompt({ context: 'PROJECTS', message: 'Use OpenCode' });

    expect(prompt).toContain('"claude"|"codex"|"opencode"');
  });
});

import { describe, expect, it } from 'vitest';
import { assertHealthyAgentResult, parseAgentRoundTripArgs } from './agentRoundTrip.js';

describe('headless agent smoke', () => {
  it('parses an explicit provider and optional switch provider', () => {
    expect(parseAgentRoundTripArgs([
      '--provider', 'claude',
      '--switch-provider', 'codex',
      '--prompt', 'health check',
    ], {})).toEqual({
      provider: 'claude',
      switchProvider: 'codex',
      prompt: 'health check',
    });
  });

  it('accepts a normal primary-agent result', () => {
    expect(() => assertHealthyAgentResult(
      { kind: 'reply', text: 'The primary agent is ready.' },
      'claude',
    )).not.toThrow();
  });

  it.each([
    'I could not complete the coordination turn: provider unavailable',
    'Codex sign-in is required. Run /codex-auth login, then try again.',
    'Codex CLI compatibility error: model `example` requires a newer Codex version.',
    'I could not form a response.',
    '{"type":"error","status":400,"error":{"message":"model unavailable"}}',
  ])('rejects provider failure replies: %s', failureReply => {
    expect(() => assertHealthyAgentResult(
      { kind: 'reply', text: failureReply },
      'provider',
    )).toThrow(/provider.*failed|unhealthy/i);
  });

  it('rejects an empty primary-agent result', () => {
    expect(() => assertHealthyAgentResult(
      { kind: 'reply', text: '   ' },
      'claude',
    )).toThrow(/empty/i);
  });
});

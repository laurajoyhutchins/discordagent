import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AGENT_PROVIDER_IDS,
  AGENT_EVENT_TYPES,
  TASK_STATUSES,
  isAgentEvent,
  isAgentProviderId,
  isTaskStatus,
  type AgentEvent,
  type AgentProvider,
  type AgentProviderId,
  type ProviderSession,
} from './contracts.js';

describe('agent provider identifiers', () => {
  it('accepts only the supported provider identifiers', () => {
    expect(isAgentProviderId('claude')).toBe(true);
    expect(isAgentProviderId('codex')).toBe(true);
    expect(isAgentProviderId('openai')).toBe(false);
    expect(isAgentProviderId(undefined)).toBe(false);
  });

  it('accepts OpenCode as a provider identifier', () => {
    expect(isAgentProviderId('opencode')).toBe(true);
    expect(AGENT_PROVIDER_IDS).toContain('opencode');
  });

  it('keeps provider sessions scoped to a supported provider', () => {
    const session = {
      provider: 'claude',
      sessionId: 'session-123',
      createdAt: 1,
    } satisfies ProviderSession;

    expectTypeOf(session.provider).toEqualTypeOf<'claude'>();
    expect(isAgentProviderId(session.provider)).toBe(true);
  });
});

describe('task lifecycle states', () => {
  it('recognizes every durable task state and rejects unknown states', () => {
    for (const status of TASK_STATUSES) {
      expect(isTaskStatus(status)).toBe(true);
    }

    expect(isTaskStatus('queued')).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
  });
});

describe('normalized agent events', () => {
  it('recognizes every declared event variant', () => {
    const fixtures: Record<(typeof AGENT_EVENT_TYPES)[number], AgentEvent> = {
      session_started: {
        type: 'session_started',
        session: { provider: 'claude', sessionId: 's1', createdAt: 1 },
      },
      text_delta: { type: 'text_delta', text: 'hello' },
      status: { type: 'status', phase: 'working' },
      plan: { type: 'plan', items: [{ text: 'Inspect repo', status: 'pending' }] },
      command: { type: 'command', command: 'npm test', state: 'running' },
      file_change: { type: 'file_change', paths: ['src/index.ts'] },
      approval_request: {
        type: 'approval_request',
        request: { id: 'a1', kind: 'command', title: 'Run tests', details: 'npm test' },
      },
      user_question: {
        type: 'user_question',
        question: { id: 'q1', prompt: 'Choose one', options: [{ label: 'A', value: 'a' }] },
      },
      usage: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
      completed: {
        type: 'completed',
        result: {
          provider: 'claude',
          outcome: 'completed',
          exitType: 'success',
          startedAt: 1,
          completedAt: 2,
        },
      },
      failed: {
        type: 'failed',
        error: { code: 'provider_error', message: 'failed', retryable: false },
      },
    };

    for (const type of AGENT_EVENT_TYPES) {
      expect(isAgentEvent(fixtures[type])).toBe(true);
    }
  });

  it('rejects malformed and unknown event payloads', () => {
    expect(isAgentEvent({ type: 'text_delta' })).toBe(false);
    expect(isAgentEvent({ type: 'plan', items: [{ text: 'x', status: 'invented' }] })).toBe(false);
    expect(isAgentEvent({ type: 'command', command: 'npm test', state: 'queued' })).toBe(false);
    expect(isAgentEvent({
      type: 'approval_request',
      request: { id: 'a1', kind: 'network', title: 'Open port', details: '8080' },
    })).toBe(false);
    expect(isAgentEvent({ type: 'usage', usage: { inputTokens: 'ten' } })).toBe(false);
    expect(isAgentEvent({ type: 'mystery', value: 1 })).toBe(false);
    expect(isAgentEvent(null)).toBe(false);
  });

  it('defines the provider interface without Discord or SDK types', () => {
    expectTypeOf<AgentProvider['id']>().toEqualTypeOf<AgentProviderId>();
    expectTypeOf<ReturnType<AgentProvider['startTask']>>().toEqualTypeOf<
      Promise<import('./contracts.js').ProviderRun>
    >();
  });
});

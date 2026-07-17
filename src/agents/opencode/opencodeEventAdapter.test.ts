import { describe, expect, it } from 'vitest';
import type { ApprovalDecision } from '../contracts.js';
import {
  adaptSessionUpdate,
  approvalRequestFromAcp,
  permissionOutcome,
  taskResultFromPrompt,
} from './opencodeEventAdapter.js';

describe('adaptSessionUpdate', () => {
  it('normalizes assistant text and suppresses thought chunks', () => {
    expect(adaptSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    })).toEqual([{ type: 'text_delta', text: 'hello' }]);

    expect(adaptSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private thought' } },
    })).toEqual([]);
  });

  it('normalizes plans and all ACP tool lifecycle states', () => {
    expect(adaptSessionUpdate({
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Inspect', priority: 'high', status: 'in_progress' },
          { content: 'Test', priority: 'medium', status: 'completed' },
        ],
      },
    })).toEqual([{
      type: 'plan',
      items: [
        { id: '0', text: 'Inspect', status: 'in_progress' },
        { id: '1', text: 'Test', status: 'completed' },
      ],
    }]);

    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Run tests', kind: 'execute', status: 'pending',
      rawInput: { command: 'npm test', API_KEY: 'input-secret' },
    } })).toEqual([{
      type: 'command',
      command: 'Run tests npm test',
      state: 'requested',
    }]);

    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'Run tests', kind: 'execute', status: 'in_progress',
      rawOutput: { output: 'working', token: 'output-secret' },
    } })).toEqual([{
      type: 'command',
      command: 'Run tests',
      state: 'running',
      output: '{"output":"working","token":"[REDACTED]"}',
    }]);

    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'Run tests', kind: 'execute', status: 'completed',
      rawOutput: 'done',
    } })).toEqual([{ type: 'command', command: 'Run tests', state: 'completed', output: '"done"' }]);

    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'Run tests', kind: 'execute', status: 'failed',
    } })).toEqual([{ type: 'command', command: 'Run tests', state: 'failed' }]);
  });

  it('emits changed file paths for edit, delete, and move tools', () => {
    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call', toolCallId: 'edit-1', title: 'Edit file', kind: 'edit', status: 'completed',
      locations: [{ path: 'src/index.ts' }],
    } })).toEqual([
      { type: 'file_change', paths: ['src/index.ts'], summary: 'Edit file (completed)' },
    ]);

    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'move-1', title: 'Move file', kind: 'move', status: 'in_progress',
      locations: [{ path: 'src/old.ts' }, { path: 'src/new.ts' }],
    } })).toEqual([
      { type: 'file_change', paths: ['src/old.ts', 'src/new.ts'], summary: 'Move file (running)' },
    ]);

    const [status] = adaptSessionUpdate({ update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'search-1', title: 'Search files', kind: 'search', status: 'failed',
      rawInput: { pattern: 'API_KEY=secret' }, rawOutput: { error: 'password=hidden' },
    } });
    expect(status).toMatchObject({ type: 'status', phase: 'tool:search:failed' });
    expect(status).toHaveProperty('detail');
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(JSON.stringify(status)).not.toContain('hidden');
  });

  it('normalizes usage updates and ignores unknown or malformed updates', () => {
    expect(adaptSessionUpdate({ update: {
      sessionUpdate: 'usage_update', used: 40, size: 100,
    } })).toEqual([{ type: 'usage', usage: { totalTokens: 40, utilization: 0.4 } }]);
    expect(adaptSessionUpdate({ update: { sessionUpdate: 'future_update', secret: 'API_KEY=leak' } })).toEqual([]);
    expect(adaptSessionUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } } })).toEqual([]);
    expect(adaptSessionUpdate(null)).toEqual([]);
  });
});

describe('OpenCode ACP permissions', () => {
  const request = {
    sessionId: 'session-1',
    toolCall: {
      toolCallId: 'tool-1', title: 'Run command', kind: 'execute', status: 'pending',
      rawInput: { command: 'npm test', password: 'secret' },
    },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    ],
  };

  it('maps a permission request to the provider-neutral approval contract', () => {
    expect(approvalRequestFromAcp(request)).toEqual({
      id: 'tool-1',
      kind: 'command',
      title: 'Run command',
      details: 'npm test',
      risk: 'high',
    });
    expect(JSON.stringify(approvalRequestFromAcp(request))).not.toContain('secret');
  });

  it.each([
    ['allow', { outcome: 'selected', optionId: 'allow-once' }],
    ['deny', { outcome: 'selected', optionId: 'reject-once' }],
    ['timeout', { outcome: 'selected', optionId: 'reject-once' }],
  ] as const)('maps %s to the matching ACP option', (decision, expected) => {
    expect(permissionOutcome(decision as ApprovalDecision, request.options)).toEqual(expected);
  });

  it('cancels when the ACP request has no compatible options', () => {
    expect(permissionOutcome('allow', [])).toEqual({ outcome: 'cancelled' });
  });

  it('never escalates an allow decision to a persistent option', () => {
    expect(permissionOutcome('allow', [
      { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
    ])).toEqual({ outcome: 'cancelled' });
    expect(permissionOutcome('allow', [
      { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    ])).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(permissionOutcome('deny', [
      { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
    ])).toEqual({ outcome: 'cancelled' });
  });
});

describe('taskResultFromPrompt', () => {
  it('normalizes completion, usage, and timestamps from the ACP prompt result', () => {
    expect(taskResultFromPrompt({
      provider: 'opencode',
      startedAt: 1234.5,
      completedAt: 5678.25,
      sessionId: 'session-1',
      promptResult: {
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedReadTokens: 2 },
      },
      text: 'Completed API_KEY=hidden',
    })).toEqual({
      provider: 'opencode',
      outcome: 'completed',
      exitType: 'end_turn',
      startedAt: 1234.5,
      completedAt: 5678.25,
      sessionId: 'session-1',
      summary: 'Completed API_KEY=[REDACTED]',
      usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 2, totalTokens: 14 },
    });
  });

  it('maps cancellation and refusal without leaking malformed prompt data', () => {
    expect(taskResultFromPrompt({
      provider: 'opencode', startedAt: 0, completedAt: 1, sessionId: 'session-1',
      promptResult: { stopReason: 'cancelled', password: 'secret' }, text: '',
    })).toMatchObject({ outcome: 'cancelled', exitType: 'cancelled', startedAt: 0, completedAt: 1 });
    expect(taskResultFromPrompt({
      provider: 'opencode', startedAt: 2, completedAt: 3, sessionId: 'session-1',
      promptResult: { stopReason: 'refusal' }, text: 'refused',
    })).toMatchObject({
      outcome: 'failed', exitType: 'refusal', error: { code: 'opencode_refusal', message: 'refused', retryable: false },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { adaptCodexNotification } from './codexEventAdapter.js';

describe('adaptCodexNotification', () => {
  it('reads current turn completion status and errors from the nested turn object', () => {
    const result = adaptCodexNotification('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'boom' } },
    }, 10);
    expect(result.terminal).toMatchObject({ outcome: 'failed', exitType: 'failed', summary: 'boom', startedAt: 10 });
  });

  it('normalizes current plan and authoritative item lifecycle events', () => {
    expect(adaptCodexNotification('turn/plan/updated', {
      threadId: 'thread-1', turnId: 'turn-1', plan: [{ step: 'Test', status: 'inProgress' }],
    }).events).toEqual([{ type: 'plan', items: [{ id: '0', text: 'Test', status: 'in_progress' }] }]);
    expect(adaptCodexNotification('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', item: { type: 'commandExecution', command: 'npm test', status: 'completed', aggregatedOutput: 'ok' },
    }).events).toEqual([{ type: 'command', command: 'npm test', state: 'completed', output: 'ok' }]);
    expect(adaptCodexNotification('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', item: { type: 'fileChange', status: 'completed', changes: [{ path: 'src/a.ts', kind: 'update', diff: '@@' }] },
    }).events).toEqual([{ type: 'file_change', paths: ['src/a.ts'], summary: '@@' }]);
  });

  it('normalizes current token-usage payloads', () => {
    const events = adaptCodexNotification('thread/tokenUsage/updated', {
      threadId: 'thread-1', tokenUsage: { total: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 14 } },
    }).events;
    expect(events).toEqual([{ type: 'usage', usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 2, totalTokens: 14 } }]);
  });
});

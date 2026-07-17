import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunHost } from '../contracts.js';
import { CodexProvider } from './codexProvider.js';

class FakeTransport extends EventEmitter {
  handlers = new Map<string, Function>();
  request = vi.fn(async (method: string) => method === 'thread/start' ? { thread: { id: 'thread-1' } } : method === 'thread/resume' ? { thread: { id: 'thread-1' } } : method === 'turn/start' ? { turn: { id: 'turn-1' } } : {});
  handleServerRequest(method: string, fn: Function) { this.handlers.set(method, fn); return () => this.handlers.delete(method); }
}

function createHost(overrides: Partial<AgentRunHost> = {}): AgentRunHost {
  return {
    emit: async () => {},
    requestApproval: async () => 'allow',
    requestUserInput: async () => ({ skipped: false, values: ['yes'] }),
    ...overrides,
  };
}

const startInput = { taskId: 'task', projectName: 'p', workingDirectory: '/repo', channelId: 'c', threadId: 'd', prompt: 'hello', model: 'gpt-5.4', reasoningEffort: 'xhigh' as const };

describe('CodexProvider', () => {
  it('uses documented thread and turn policy values and returns the session before completion', async () => {
    const transport = new FakeTransport();
    const events: unknown[] = [];
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    const run = await provider.startTask(startInput, createHost({ emit: async event => { events.push(event); } }));
    expect(run.session.sessionId).toBe('thread-1');
    expect(transport.request).toHaveBeenNthCalledWith(1, 'thread/start', {
      cwd: '/repo', model: 'gpt-5.4', approvalPolicy: 'onRequest', sandbox: 'workspaceWrite', serviceName: 'discord-agent',
    });
    expect(transport.request).toHaveBeenNthCalledWith(2, 'turn/start', {
      threadId: 'thread-1', input: [{ type: 'text', text: 'hello' }], cwd: '/repo', model: 'gpt-5.4',
      effort: 'xhigh',
      approvalPolicy: 'onRequest', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/repo'], networkAccess: false },
    });
    transport.emit('notification', 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'hi' });
    transport.emit('notification', 'turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } });
    await expect(run.completion).resolves.toMatchObject({ outcome: 'completed', sessionId: 'thread-1' });
    expect(events).toContainEqual({ type: 'text_delta', text: 'hi' });
  });

  it('resumes a stored thread before starting a continuation turn', async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    await provider.continueTask({ ...startInput, session: { provider: 'codex', sessionId: 'thread-1', createdAt: 1 } }, createHost());
    expect(transport.request).toHaveBeenNthCalledWith(1, 'thread/resume', {
      threadId: 'thread-1', cwd: '/repo', model: 'gpt-5.4', approvalPolicy: 'onRequest', sandbox: 'workspaceWrite', serviceName: 'discord-agent',
    });
    expect(transport.request).toHaveBeenNthCalledWith(2, 'turn/start', expect.objectContaining({ threadId: 'thread-1' }));
  });

  it('maps command and file approvals to App Server decisions', async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    await provider.startTask(startInput, createHost());
    await expect(transport.handlers.get('item/commandExecution/requestApproval')!('x', { threadId: 'thread-1', itemId: 'item-1', command: 'npm test' })).resolves.toEqual({ decision: 'accept' });
    await expect(transport.handlers.get('item/fileChange/requestApproval')!('x', { threadId: 'thread-1', itemId: 'item-2', reason: 'apply patch' })).resolves.toEqual({ decision: 'accept' });
  });

  it('denies built-in permission elevation by default', async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    await provider.startTask(startInput, createHost({ requestApproval: async () => 'deny' }));
    await expect(transport.handlers.get('item/permissions/requestApproval')!('x', {
      threadId: 'thread-1', permissions: { network: { enabled: true }, fileSystem: { writableRoots: ['/outside'] } },
    })).resolves.toEqual({ permissions: {}, scope: 'turn' });
  });

  it('returns question-id keyed answers and never collects secret input through Discord', async () => {
    const transport = new FakeTransport();
    const questions: unknown[] = [];
    const events: unknown[] = [];
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    await provider.startTask(startInput, createHost({
      emit: async event => { events.push(event); },
      requestUserInput: async question => { questions.push(question); return { skipped: false, values: ['Option A'] }; },
    }));

    await expect(transport.handlers.get('item/tool/requestUserInput')!('x', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-3',
      questions: [
        { id: 'choice', header: 'Choose', question: 'Which option?', isOther: false, isSecret: false, options: [{ label: 'Option A', description: 'recommended' }] },
        { id: 'secret', header: 'Credential', question: 'Enter token', isOther: true, isSecret: true, options: null },
      ],
      autoResolutionMs: null,
    })).resolves.toEqual({ answers: {
      choice: { answers: ['Option A'] },
      secret: { answers: [] },
    } });
    expect(questions).toEqual([expect.objectContaining({
      id: 'choice', prompt: 'Choose\nWhich option?', options: [{ label: 'Option A', value: 'Option A' }], allowFreeText: false,
    })]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', phase: 'Secret input required' }));
  });

  it('grants only explicitly approved permissions contained by the task worktree', async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport: transport as never, auth: { readAccount: async () => ({ authenticated: true }) } as never });
    await provider.startTask(startInput, createHost({ requestApproval: async () => 'allow' }));
    await expect(transport.handlers.get('item/permissions/requestApproval')!('x', {
      threadId: 'thread-1',
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/repo', '/outside'], write: ['/repo/src', '/outside'], globScanMaxDepth: 4 },
      },
    })).resolves.toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/repo'], write: ['/repo/src'] },
      },
      scope: 'turn',
    });
  });

});

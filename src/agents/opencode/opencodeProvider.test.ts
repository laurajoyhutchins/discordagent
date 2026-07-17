import { describe, expect, it, vi } from 'vitest';
import type { AgentRunHost, StartTaskInput } from '../contracts.js';
import type { OpenCodeAcpConnection, OpenCodeAcpHandlers } from './acpTransport.js';
import { OpenCodeProvider } from './opencodeProvider.js';

function input(overrides: Partial<StartTaskInput> = {}): StartTaskInput {
  return {
    taskId: 'task-1', projectName: 'demo', workingDirectory: 'C:\\repo', channelId: 'channel-1',
    threadId: 'thread-1', prompt: 'fix it', ...overrides,
  };
}

function host(overrides: Partial<AgentRunHost> = {}): AgentRunHost {
  return {
    emit: vi.fn(async () => undefined),
    requestApproval: vi.fn(async () => 'deny' as const),
    requestUserInput: vi.fn(async () => ({ skipped: true, values: [] })),
    ...overrides,
  };
}

function connection(overrides: Partial<OpenCodeAcpConnection> = {}): OpenCodeAcpConnection {
  return {
    initialize: vi.fn(async () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } })),
    newSession: vi.fn(async () => ({ sessionId: 'session-1', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'model-a', options: [{ value: 'model-a', name: 'Model A' }] }] as any })),
    loadSession: vi.fn(async () => ({ configOptions: [] })),
    resumeSession: vi.fn(async () => ({ configOptions: [] })),
    setSessionConfigOption: vi.fn(async () => ({ configOptions: [] })),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' as const })),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function provider(conn: OpenCodeAcpConnection, overrides: Partial<ConstructorParameters<typeof OpenCodeProvider>[0]> = {}) {
  return new OpenCodeProvider({ cliPath: 'opencode', timeoutMs: 1_000, createConnection: vi.fn(async (_handlers: OpenCodeAcpHandlers) => conn), now: () => 100, ...overrides });
}

describe('OpenCodeProvider lifecycle', () => {
  it('creates and emits the ACP session before the completion promise is awaited', async () => {
    const conn = connection();
    const run = await provider(conn).startTask(input(), host());
    expect(run.session).toEqual({ provider: 'opencode', sessionId: 'session-1', createdAt: 100 });
    expect(run.completion).toBeInstanceOf(Promise);
    await expect(run.completion).resolves.toMatchObject({ outcome: 'completed', sessionId: 'session-1' });
  });

  it('continues only an OpenCode session and resumes the persisted ID', async () => {
    const conn = connection();
    const p = provider(conn);
    await expect(p.continueTask({ ...input(), session: { provider: 'claude', sessionId: 'x', createdAt: 1 } }, host())).rejects.toThrow(/Cannot resume/);
    const run = await p.continueTask({ ...input(), session: { provider: 'opencode', sessionId: 'session-1', createdAt: 5 } }, host());
    expect(conn.resumeSession).toHaveBeenCalledWith('session-1', 'C:\\repo');
    expect(run.session.createdAt).toBe(5);
    await run.completion;
  });

  it('applies the requested model through the ACP model config option', async () => {
    const conn = connection();
    const run = await provider(conn).startTask(input({ model: 'model-a' }), host());
    expect(conn.setSessionConfigOption).toHaveBeenCalledWith('session-1', 'model', 'model-a');
    await run.completion;
  });

  it('fails explicitly when the requested model is not advertised', async () => {
    const conn = connection();
    await expect(provider(conn).startTask(input({ model: 'missing' }), host())).rejects.toThrow(/not advertised/);
    expect(conn.close).toHaveBeenCalled();
  });

  it('routes ACP permission requests through the host approval broker', async () => {
    let handlers!: OpenCodeAcpHandlers;
    const conn = connection({ prompt: vi.fn(async () => {
      const response = await handlers.onPermission({
        sessionId: 'session-1',
        toolCall: { toolCallId: 'call-1', kind: 'execute', title: 'Run command', status: 'pending' },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
        ],
      });
      expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow' });
      return { stopReason: 'end_turn' as const };
    }) });
    const approval = vi.fn(async () => 'allow' as const);
    const run = await new OpenCodeProvider({ cliPath: 'opencode', timeoutMs: 1_000, createConnection: vi.fn(async h => { handlers = h; return conn; }) }).startTask(input(), host({ requestApproval: approval }));
    await run.completion;
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command' }));
  });

  it('cancels the ACP prompt and cleans up the process', async () => {
    let resolvePrompt!: (value: { stopReason: 'cancelled' }) => void;
    const conn = connection({ prompt: vi.fn(() => new Promise<{ stopReason: 'cancelled' }>(resolve => { resolvePrompt = resolve; })) });
    const p = provider(conn);
    const run = await p.startTask(input(), host());
    await p.cancelTask('session-1');
    expect(conn.cancel).toHaveBeenCalledWith('session-1');
    expect(conn.close).toHaveBeenCalled();
    resolvePrompt({ stopReason: 'cancelled' });
    await expect(run.completion).resolves.toMatchObject({ outcome: 'cancelled' });
  });

  it('normalizes prompt failures and closes the connection', async () => {
    const conn = connection({ prompt: vi.fn(async () => { throw new Error('Bearer sk-secret-value'); }) });
    const run = await provider(conn).startTask(input(), host());
    const result = await run.completion;
    expect(result).toMatchObject({ outcome: 'failed', error: { code: 'opencode_error' } });
    expect(result.summary).not.toContain('sk-secret');
    expect(conn.close).toHaveBeenCalled();
  });
});

describe('OpenCodeProvider availability and estimates', () => {
  it('probes initialization without creating a task session', async () => {
    const conn = connection();
    const p = provider(conn);
    await expect(p.checkAvailability()).resolves.toEqual({ available: true });
    expect(conn.newSession).not.toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
  });

  it('rejects unsupported protocol and redacts authentication errors', async () => {
    const unsupported = connection({ initialize: vi.fn(async () => ({ protocolVersion: 99 })) });
    await expect(provider(unsupported).checkAvailability()).resolves.toMatchObject({ available: false, reason: expect.stringContaining('unsupported') });
    const auth = provider(connection({ initialize: vi.fn(async () => { throw new Error('authorization=Bearer top-secret'); }) }));
    await expect(auth.checkAvailability()).resolves.toMatchObject({ available: false, authenticationRequired: true, reason: expect.not.stringContaining('top-secret') });
  });

  it('uses the deterministic handoff estimate', async () => {
    const estimate = await provider(connection()).estimateHandoff({ sourceProvider: 'claude', targetProvider: 'opencode', summaryCharacters: 100, transcriptCharacters: 900, changedFiles: 2 });
    expect(estimate).toMatchObject({ estimatedInputTokens: 325, confidence: 'medium' });
  });
});

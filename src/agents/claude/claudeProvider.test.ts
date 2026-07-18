import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentRunHost,
  ApprovalDecision,
  ProviderSession,
  UserAnswer,
} from '../contracts.js';
import {
  ClaudeProvider,
  type ClaudeQueryFunction,
  type ClaudeQueryRequest,
} from './claudeProvider.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return {
    promise: new Promise<void>(done => { resolve = done; }),
    resolve,
  };
}

function initMessage(sessionId = 'session-1') {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-test',
  };
}

function successResult(sessionId = 'session-1') {
  return {
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    result: 'Finished successfully',
    total_cost_usd: 0.02,
    duration_ms: 1200,
    num_turns: 2,
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 40,
    },
  };
}

function createHost(input: {
  approval?: ApprovalDecision;
  answer?: UserAnswer;
} = {}) {
  const events: AgentEvent[] = [];
  const approvals: Array<{ title: string; details: string }> = [];
  const questions: string[] = [];
  const host: AgentRunHost = {
    async emit(event) { events.push(event); },
    async requestApproval(request) {
      approvals.push({ title: request.title, details: request.details });
      return input.approval ?? 'allow';
    },
    async requestUserInput(question) {
      questions.push(question.prompt);
      return input.answer ?? { skipped: false, values: ['A'] };
    },
  };
  return { host, events, approvals, questions };
}

function startInput() {
  return {
    taskId: 'task-1',
    projectName: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    channelId: 'agent-1',
    threadId: 'thread-1',
    prompt: 'Implement the worker registry',
    model: 'request-model',
  };
}

describe('ClaudeProvider', () => {
  it('uses the resolved task timeout for the provider turn', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const queryFn: ClaudeQueryFunction = () => (async function* () {
        yield initMessage('timeout-session');
        yield successResult('timeout-session');
      })();
      const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });
      const { host } = createHost();
      const run = await provider.startTask({ ...startInput(), settings: { timeoutMs: 25 } }, host);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25);
      await expect(run.completion).resolves.toMatchObject({ outcome: 'completed' });
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('uses the snapshotted model and resolves only the selected host MCP profile', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const queryFn: ClaudeQueryFunction = request => {
      captured = request;
      return (async function* () {
        yield initMessage('settings-session');
        yield successResult('settings-session');
      })();
    };
    const resolveMcpServers = vi.fn((profile?: string) => profile === 'browser'
      ? { playwright: { type: 'stdio', command: 'playwright-mcp' } as never }
      : undefined);
    const provider = new ClaudeProvider({
      queryFn,
      resolveMcpServers,
    });

    const run = await provider.startTask({
      ...startInput(), model: 'legacy-model', settings: { model: 'snapshot-model', mcpProfile: 'browser' },
    }, createHost().host);
    await run.completion;

    expect(resolveMcpServers).toHaveBeenCalledWith('browser');
    expect(captured?.options?.model).toBe('snapshot-model');
    expect(captured?.options?.mcpServers).toEqual({ playwright: { type: 'stdio', command: 'playwright-mcp' } });
  });

  it('resolves an absent MCP profile through the host default allowlist', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const defaultServers = { playwright: { type: 'stdio', command: 'playwright-mcp' } as never };
    const resolveMcpServers = vi.fn((profile?: string) => profile === undefined || profile === 'default'
      ? defaultServers : undefined);
    const provider = new ClaudeProvider({
      queryFn: request => {
        captured = request;
        return (async function* () {
          yield initMessage('default-mcp-session');
          yield successResult('default-mcp-session');
        })();
      },
      resolveMcpServers,
    });

    const run = await provider.startTask(startInput(), createHost().host);
    await run.completion;

    expect(resolveMcpServers).toHaveBeenCalledWith(undefined);
    expect(captured?.options?.mcpServers).toEqual(defaultServers);
  });

  it('passes an explicit disabled MCP profile as an empty server map', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const resolveMcpServers = vi.fn((profile?: string) => profile === 'disabled' ? {} : undefined);
    const provider = new ClaudeProvider({
      queryFn: request => {
        captured = request;
        return (async function* () {
          yield initMessage('disabled-mcp-session');
          yield successResult('disabled-mcp-session');
        })();
      },
      resolveMcpServers,
    });

    const run = await provider.startTask({ ...startInput(), settings: { mcpProfile: 'disabled' } }, createHost().host);
    await run.completion;

    expect(resolveMcpServers).toHaveBeenCalledWith('disabled');
    expect(captured?.options).toHaveProperty('mcpServers', {});
  });

  it('fails closed when a snapshotted MCP profile is no longer available', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const provider = new ClaudeProvider({
      queryFn: request => {
        captured = request;
        return (async function* () {
          yield initMessage('removed-mcp-session');
          yield successResult('removed-mcp-session');
        })();
      },
      resolveMcpServers: () => undefined,
    });

    const run = await provider.startTask({ ...startInput(), settings: { mcpProfile: 'removed-profile' } }, createHost().host);
    await run.completion;

    expect(captured?.options).toHaveProperty('mcpServers', {});
  });

  it('uses the immutable snapshot for resume and only the turn settings for this turn', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const provider = new ClaudeProvider({
      queryFn: request => {
        captured = request;
        return (async function* () {
          yield initMessage('continuation-settings-session');
          yield successResult('continuation-settings-session');
        })();
      },
      resolveMcpServers: () => undefined,
    });

    const run = await provider.continueTask({
      ...startInput(),
      model: 'legacy-model',
      settings: { model: 'snapshot-model', timeoutMs: 60_000 },
      turnSettings: { model: 'turn-model', timeoutMs: 5_000 },
      session: { provider: 'claude', sessionId: 'continuation-settings-session', createdAt: 1 },
    }, createHost().host);
    await run.completion;

    expect(captured?.options?.model).toBe('turn-model');
    expect(captured?.options?.resume).toBe('continuation-settings-session');
  });

  it('rejects unsupported Claude reasoning and approval settings before the SDK request', async () => {
    const queryFn = vi.fn<ClaudeQueryFunction>(() => (async function* () {
      yield initMessage('unsupported-settings-session');
      yield successResult('unsupported-settings-session');
    })());
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });

    await expect(provider.startTask({ ...startInput(), settings: { reasoningEffort: 'high' } }, createHost().host))
      .rejects.toThrow(/Claude.*reasoningEffort.*support/i);
    expect(queryFn).not.toHaveBeenCalled();
    await expect(provider.startTask({ ...startInput(), settings: { approvalProfile: 'strict' } }, createHost().host))
      .rejects.toThrow(/Claude.*approvalProfile.*support/i);
    await expect(provider.startTask({ ...startInput(), settings: { unexpected: true } as never }, createHost().host))
      .rejects.toThrow(/Claude.*unexpected.*support/i);
  });

  it('rejects unsupported continuation turn settings before the SDK request', async () => {
    const queryFn = vi.fn<ClaudeQueryFunction>(() => (async function* () {
      yield initMessage('unsupported-turn-settings-session');
      yield successResult('unsupported-turn-settings-session');
    })());
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });

    await expect(provider.continueTask({
      ...startInput(),
      settings: { model: 'snapshot-model', timeoutMs: 60_000 },
      turnSettings: { reasoningEffort: 'high' } as never,
      session: { provider: 'claude', sessionId: 'existing-session', createdAt: 1 },
    }, createHost().host)).rejects.toThrow(/Claude.*reasoningEffort.*support/i);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('returns the provider session before completion and normalizes streaming, usage, and result data', async () => {
    const gate = deferred();
    let captured: ClaudeQueryRequest | undefined;
    const queryFn: ClaudeQueryFunction = request => {
      captured = request;
      return (async function* () {
        yield initMessage();
        yield {
          type: 'assistant',
          session_id: 'session-1',
          message: { content: [{ type: 'text', text: 'Working...' }] },
        };
        await gate.promise;
        yield {
          type: 'rate_limit_event',
          session_id: 'session-1',
          rate_limit_info: { utilization: 0.4, resetsAt: 999, status: 'allowed' },
        };
        yield successResult();
      })();
    };
    const rateLimit = vi.fn();
    const sessionResult = vi.fn(async () => {});
    const { host, events } = createHost();
    const provider = new ClaudeProvider({
      queryFn,
      resolveMcpServers: () => undefined,
      env: {
        SAFE_VALUE: 'ok',
        CLAUDECODE: 'must-be-removed',
        BROKEN: '\uD800',
      },
      onRateLimit: rateLimit,
      onSessionResult: sessionResult,
      now: () => 1000,
    });

    const run = await provider.startTask(startInput(), host);
    expect(run.session).toEqual({ provider: 'claude', sessionId: 'session-1', createdAt: 1000 });
    let completed = false;
    void run.completion.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    expect(captured?.prompt).toBe('Implement the worker registry');
    expect(captured?.options?.cwd).toBe('/repos/factory-floor');
    expect(captured?.options?.model).toBe('request-model');
    expect(captured?.options?.settingSources).toEqual(['user']);
    expect(captured?.options?.env).toEqual({ SAFE_VALUE: 'ok' });

    gate.resolve();
    await expect(run.completion).resolves.toMatchObject({
      provider: 'claude',
      outcome: 'completed',
      exitType: 'success',
      sessionId: 'session-1',
      summary: 'Finished successfully',
      costUsd: 0.02,
      durationMs: 1200,
      numTurns: 2,
      usage: {
        inputTokens: 100,
        outputTokens: 25,
        cachedInputTokens: 40,
        totalTokens: 125,
      },
    });
    expect(events).toEqual(expect.arrayContaining([
      { type: 'session_started', session: run.session },
      { type: 'text_delta', text: 'Working...' },
      { type: 'usage', usage: { utilization: 0.4, resetsAt: 999 } },
    ]));
    expect(rateLimit).toHaveBeenCalledWith(expect.objectContaining({ utilization: 0.4 }));
    expect(sessionResult).toHaveBeenCalledWith('factory-floor', expect.objectContaining({
      type: 'result',
      subtype: 'success',
    }));
  });

  it('bridges auto-approved tools, explicit approvals, denials, and user questions', async () => {
    const permissionResults: unknown[] = [];
    const queryFn: ClaudeQueryFunction = request => (async function* () {
      yield initMessage('tools-session');
      const canUseTool = request.options?.canUseTool;
      if (!canUseTool) throw new Error('missing canUseTool');
      const signal = new AbortController().signal;
      permissionResults.push(await canUseTool('Read', { file_path: 'README.md' }, {
        signal,
        toolUseID: 'read-1',
      }));
      permissionResults.push(await canUseTool('Bash', { command: 'npm test' }, {
        signal,
        toolUseID: 'bash-1',
      }));
      permissionResults.push(await canUseTool('Write', { file_path: 'danger.txt' }, {
        signal,
        toolUseID: 'write-1',
      }));
      permissionResults.push(await canUseTool('AskUserQuestion', {
        questions: [{
          question: 'Choose an approach',
          options: [{ label: 'A', description: 'Approach A' }],
        }],
      }, {
        signal,
        toolUseID: 'question-1',
      }));
      yield successResult('tools-session');
    })();

    let approvalCount = 0;
    const base = createHost({ answer: { skipped: false, values: ['A'] } });
    base.host.requestApproval = async request => {
      base.approvals.push({ title: request.title, details: request.details });
      approvalCount += 1;
      return approvalCount === 1 ? 'allow' : 'deny';
    };
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });
    const run = await provider.startTask(startInput(), base.host);
    await run.completion;

    expect(permissionResults).toEqual([
      expect.objectContaining({ behavior: 'allow' }),
      expect.objectContaining({ behavior: 'allow' }),
      expect.objectContaining({ behavior: 'deny' }),
      expect.objectContaining({
        behavior: 'allow',
        updatedInput: expect.objectContaining({ answers: { 'Choose an approach': 'A' } }),
      }),
    ]);
    expect(base.approvals.map(item => item.title)).toEqual(['Bash', 'Write']);
    expect(base.questions).toEqual(['Choose an approach']);
    expect(base.events).toEqual(expect.arrayContaining([
      { type: 'command', command: 'npm test', state: 'requested' },
      expect.objectContaining({ type: 'file_change', paths: ['danger.txt'] }),
    ]));
  });

  it('resumes a known session and cancels it through the provider session identifier', async () => {
    let captured: ClaudeQueryRequest | undefined;
    const queryFn: ClaudeQueryFunction = request => {
      captured = request;
      return (async function* () {
        yield initMessage('resume-session');
        const signal = request.options?.abortController?.signal;
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted by user'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted by user')), { once: true });
        });
      })();
    };
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });
    const { host } = createHost();
    const session: ProviderSession = {
      provider: 'claude',
      sessionId: 'resume-session',
      createdAt: 1,
    };

    const run = await provider.continueTask({ ...startInput(), session }, host);
    expect(run.session).toBe(session);
    expect(captured?.options?.resume).toBe('resume-session');
    await provider.cancelTask('resume-session');
    await expect(run.completion).resolves.toMatchObject({
      provider: 'claude',
      outcome: 'cancelled',
      exitType: 'cancelled',
      sessionId: 'resume-session',
    });
  });

  it('rejects deterministically when the SDK stream ends before supplying a session ID', async () => {
    const queryFn: ClaudeQueryFunction = () => (async function* () {
      yield { type: 'mystery', payload: true };
    })();
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined });
    const { host } = createHost();

    await expect(Promise.race([
      provider.startTask(startInput(), host),
      new Promise((_, reject) => setTimeout(() => reject(new Error('startTask remained pending')), 100)),
    ])).rejects.toThrow(/session id/i);
  });

  it('ignores malformed messages and checkpoints an interrupted stream without inventing output', async () => {
    const queryFn: ClaudeQueryFunction = () => (async function* () {
      yield initMessage('interrupted-session');
      yield { type: 'assistant', message: { content: [{ type: 'text' }] } };
      yield { type: 'mystery', payload: true };
    })();
    const { host, events } = createHost();
    const provider = new ClaudeProvider({ queryFn, resolveMcpServers: () => undefined, now: () => 500 });

    const run = await provider.startTask(startInput(), host);
    await expect(run.completion).resolves.toMatchObject({
      outcome: 'interrupted',
      exitType: 'interrupted',
      sessionId: 'interrupted-session',
    });
    expect(events.some(event => event.type === 'text_delta')).toBe(false);
  });
});

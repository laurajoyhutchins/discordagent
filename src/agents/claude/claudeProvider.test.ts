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
      timeoutMs: 10_000,
      defaultModel: 'default-model',
      resolveProjectModel: () => 'project-model',
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
    const provider = new ClaudeProvider({ queryFn, timeoutMs: 10_000 });
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
    const provider = new ClaudeProvider({ queryFn, timeoutMs: 10_000 });
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
    const provider = new ClaudeProvider({ queryFn, timeoutMs: 10_000 });
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
    const provider = new ClaudeProvider({ queryFn, timeoutMs: 10_000, now: () => 500 });

    const run = await provider.startTask(startInput(), host);
    await expect(run.completion).resolves.toMatchObject({
      outcome: 'interrupted',
      exitType: 'interrupted',
      sessionId: 'interrupted-session',
    });
    expect(events.some(event => event.type === 'text_delta')).toBe(false);
  });
});

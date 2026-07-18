import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CodexPrimaryModel } from './codexPrimaryModel.js';

class FakeTransport extends EventEmitter {
  request = vi.fn(async (method: string) => method === 'thread/start'
    ? { thread: { id: 'primary-thread-1' } }
    : { turn: { id: 'primary-turn-1' } });
}

describe('CodexPrimaryModel', () => {
  it('uses a read-only Codex turn and parses the provider-neutral PM response', async () => {
    const transport = new FakeTransport();
    const model = new CodexPrimaryModel({
      transport: transport as never,
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      workingDirectory: 'C:/Users/Laura/Documents/discordagent',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    });

    const responsePromise = model.respond({ context: 'No active projects.', message: 'What should I do first?' });
    await new Promise(resolve => setImmediate(resolve));

    expect(transport.request).toHaveBeenNthCalledWith(1, 'thread/start', {
      cwd: 'C:/Users/Laura/Documents/discordagent',
      model: 'gpt-5.4',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'discord-agent-primary',
    });
    expect(transport.request).toHaveBeenNthCalledWith(2, 'turn/start', {
      threadId: 'primary-thread-1',
      input: [{ type: 'text', text: expect.stringContaining('What should I do first?') }],
      cwd: 'C:/Users/Laura/Documents/discordagent',
      model: 'gpt-5.4',
      effort: 'xhigh',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });

    transport.emit('notification', 'item/agentMessage/delta', {
      threadId: 'primary-thread-1',
      delta: '{"reply":"Start by selecting a provider."}',
    });
    transport.emit('notification', 'turn/completed', {
      threadId: 'primary-thread-1',
      turn: { id: 'primary-turn-1', status: 'completed' },
    });

    await expect(responsePromise).resolves.toEqual({ reply: 'Start by selecting a provider.' });
  });

  it('returns an authentication instruction when Codex is not signed in', async () => {
    const model = new CodexPrimaryModel({
      transport: new FakeTransport() as never,
      auth: { readAccount: vi.fn(async () => ({ authenticated: false })) } as never,
      workingDirectory: 'C:/tmp',
    });

    await expect(model.respond({ context: '', message: 'Hello' })).resolves.toEqual({
      reply: 'Codex sign-in is required. Run /codex-auth login, then try again.',
    });
  });

  it('returns an actionable compatibility response when the App Server rejects the model', async () => {
    const transport = new FakeTransport();
    transport.request = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'primary-thread-1' } };
      queueMicrotask(() => transport.emit('notification', 'error', {
        threadId: 'primary-thread-1',
        error: { message: "The 'gpt-5.6-luna' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again." },
      }));
      return { turn: { id: 'primary-turn-1' } };
    });
    const model = new CodexPrimaryModel({
      transport: transport as never,
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      model: 'gpt-5.6-luna',
    });

    await expect(model.respond({ context: '', message: 'Hello' })).resolves.toEqual({
      reply: 'Codex CLI compatibility error: model `gpt-5.6-luna` requires a newer Codex version. Upgrade Codex CLI, then restart the bot.',
    });
  });
});

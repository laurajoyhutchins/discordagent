import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  InitializeRequest,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionNotification,
  SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import { buildProcessInvocation } from '../../utils/processInvocation.js';
import {
  type OpenCodeAcpConnection,
  type OpenCodeAcpHandlers,
  OpenCodeAcpTransport,
  type OpenCodeAcpProcess,
} from './acpTransport.js';

class FakeProcess extends EventEmitter implements OpenCodeAcpProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: string[] = [];
  readonly killSignals: Array<NodeJS.Signals | undefined> = [];
  stdinEnded = false;
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.writes.push(String(chunk));
      callback();
    },
    final: callback => {
      this.stdinEnded = true;
      callback();
    },
  });

  respond(result: unknown): void {
    const request = this.lastRequest();
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }

  notify(method: string, params: unknown): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  request(method?: string): Record<string, any> {
    const request = this.lastRequest();
    if (method !== undefined) expect(request.method).toBe(method);
    return request;
  }

  private lastRequest(): Record<string, any> {
    return JSON.parse(this.writes.at(-1)!);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    return true;
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('OpenCodeAcpTransport', () => {
  it('exposes generated ACP types through the transport seam', () => {
    expectTypeOf<OpenCodeAcpConnection['initialize']>().toEqualTypeOf<
      () => Promise<InitializeResponse>
    >();
    expectTypeOf<OpenCodeAcpConnection['newSession']>().toEqualTypeOf<
      (cwd: string) => Promise<NewSessionResponse>
    >();
    expectTypeOf<OpenCodeAcpConnection['loadSession']>().toEqualTypeOf<
      (sessionId: string, cwd: string) => Promise<LoadSessionResponse>
    >();
    expectTypeOf<OpenCodeAcpConnection['resumeSession']>().toEqualTypeOf<
      ((sessionId: string, cwd: string) => Promise<ResumeSessionResponse>) | undefined
    >();
    expectTypeOf<OpenCodeAcpConnection['setSessionConfigOption']>().toEqualTypeOf<
      (sessionId: string, configId: string, value: string | boolean) => Promise<SetSessionConfigOptionResponse>
    >();
    expectTypeOf<OpenCodeAcpConnection['prompt']>().toEqualTypeOf<
      (sessionId: string, text: string) => Promise<PromptResponse>
    >();
    expectTypeOf<OpenCodeAcpHandlers['onSessionUpdate']>().toEqualTypeOf<
      (params: SessionNotification) => Promise<void> | void
    >();
    expectTypeOf<OpenCodeAcpHandlers['onPermission']>().toEqualTypeOf<
      (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
    >();
    expectTypeOf<InitializeRequest>().toMatchTypeOf<{
      protocolVersion: number;
      clientCapabilities?: object;
    }>();
  });

  it('launches opencode acp through the shell-free invocation helper', async () => {
    const process = new FakeProcess();
    let invocation: { command: string; args: readonly string[] } | undefined;
    let spawnOptions: Record<string, unknown> | undefined;
    const transport = new OpenCodeAcpTransport({
      cliPath: 'opencode.cmd',
      spawnProcess: (command, args, options) => {
        invocation = { command, args };
        spawnOptions = options as Record<string, unknown>;
        return process;
      },
    });

    expect(invocation).toEqual(buildProcessInvocation('opencode.cmd', ['acp']));
    expect(spawnOptions).toMatchObject({
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: globalThis.process.env,
    });
    await transport.close();
  });

  it('initializes ACP v1 with no filesystem or terminal callbacks advertised', async () => {
    const process = new FakeProcess();
    const transport = new OpenCodeAcpTransport({ process });
    const initialize = transport.initialize();
    await flush();
    const request = process.request('initialize');

    expect(request.params).toEqual({
      protocolVersion: 1,
      clientInfo: { name: 'discord-agent', version: '1.0.0' },
      clientCapabilities: {},
    });
    expect(request.params.clientCapabilities).not.toHaveProperty('fs');
    expect(request.params.clientCapabilities).not.toHaveProperty('terminal');

    process.respond({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: true } },
    });
    await expect(initialize).resolves.toMatchObject({ protocolVersion: 1 });
    await transport.close();
  });

  it('correlates session and prompt requests while routing updates to handlers', async () => {
    const process = new FakeProcess();
    const updates: unknown[] = [];
    const permissions: unknown[] = [];
    const transport = new OpenCodeAcpTransport({
      process,
      handlers: {
        onSessionUpdate: params => { updates.push(params); },
        onPermission: async params => {
          permissions.push(params);
          return { outcome: { outcome: 'selected', optionId: 'allow-once' } };
        },
      },
    });

    const session = transport.newSession('C:\\repo');
    await flush();
    process.request('session/new');
    process.respond({ sessionId: 'session-1' });
    await expect(session).resolves.toEqual({ sessionId: 'session-1' });

    const loaded = transport.loadSession('session-1', 'C:\\repo');
    await flush();
    process.request('session/load');
    process.respond({ sessionId: 'session-1' });
    await expect(loaded).resolves.toEqual({ sessionId: 'session-1' });

    const resumed = transport.resumeSession('session-1', 'C:\\repo');
    await flush();
    process.request('session/resume');
    process.respond({ sessionId: 'session-1' });
    await expect(resumed).resolves.toEqual({ sessionId: 'session-1' });

    const config = transport.setSessionConfigOption('session-1', 'model', 'openai/gpt-5');
    await flush();
    expect(process.request('session/set_config_option').params).toMatchObject({
      sessionId: 'session-1',
      configId: 'model',
      value: 'openai/gpt-5',
    });
    process.respond({ configOptions: [] });
    await expect(config).resolves.toEqual({ configOptions: [] });

    process.notify('session/update', {
      sessionId: 'session-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(updates).toEqual([{
      sessionId: 'session-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    }]);

    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'session/request_permission',
      params: { sessionId: 'session-1', toolCall: { toolCallId: 'call-1' }, options: [] },
    })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    expect(permissions).toHaveLength(1);
    expect(JSON.parse(process.writes.at(-1)!)).toMatchObject({
      id: 99,
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    });

    const prompt = transport.prompt('session-1', 'Inspect the repository');
    await flush();
    expect(process.request('session/prompt').params).toEqual({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'Inspect the repository' }],
    });
    process.respond({ stopReason: 'end_turn' });
    await expect(prompt).resolves.toEqual({ stopReason: 'end_turn' });

    const cancel = transport.cancel('session-1');
    await flush();
    process.request('session/cancel');
    process.respond({});
    await expect(cancel).resolves.toBeUndefined();
    await transport.close();
  });

  it('redacts stderr and process errors while rejecting pending operations', async () => {
    const process = new FakeProcess();
    const stderr: string[] = [];
    const transport = new OpenCodeAcpTransport({
      process,
      handlers: {
        onSessionUpdate: () => {},
        onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        onStderr: message => stderr.push(message),
      },
    });
    const pending = transport.prompt('session-1', 'continue');
    await flush();
    process.request('session/prompt');
    process.stderr.write('Authorization: Bearer sk-project-super-secret-value\n');
    process.emit('error', new Error('provider token=sk-project-super-secret-value'));

    await expect(pending).rejects.toThrow('[REDACTED]');
    expect(stderr).toEqual(['Authorization: [REDACTED]']);
  });

  it('buffers split stderr secrets until the stream is complete before redacting', async () => {
    const process = new FakeProcess();
    const stderr: string[] = [];
    const transport = new OpenCodeAcpTransport({
      process,
      handlers: { onStderr: message => stderr.push(message) },
    });

    process.stderr.write('Authorization: Bearer sk-project-');
    process.stderr.write('super-secret-value\n');
    process.stderr.end();
    await flush();

    expect(stderr).toEqual(['Authorization: [REDACTED]']);
    await transport.close();
  });

  it('rejects pending operations and terminates the process on ACP stdout EOF', async () => {
    const process = new FakeProcess();
    const transport = new OpenCodeAcpTransport({ process });
    const pending = transport.prompt('session-1', 'continue');
    await flush();
    process.request('session/prompt');

    process.stdout.end();

    await expect(pending).rejects.toThrow('closed');
    expect(process.stdinEnded).toBe(true);
    expect(process.killSignals).toEqual(['SIGTERM']);
    await transport.close();
  });

  it('rejects pending operations and terminates the process on ACP stdout errors', async () => {
    const process = new FakeProcess();
    const transport = new OpenCodeAcpTransport({ process });
    const pending = transport.prompt('session-1', 'continue');
    await flush();
    process.request('session/prompt');

    process.stdout.emit('error', new Error('provider token=sk-project-super-secret-value'));

    await expect(pending).rejects.toThrow('[REDACTED]');
    expect(process.stdinEnded).toBe(true);
    expect(process.killSignals).toEqual(['SIGTERM']);
    await transport.close();
  });

  it('closes by rejecting pending operations, ending stdin, and sending SIGTERM', async () => {
    const process = new FakeProcess();
    const transport = new OpenCodeAcpTransport({ process });
    const pending = transport.prompt('session-1', 'continue');
    await flush();
    process.request('session/prompt');

    await transport.close();

    await expect(pending).rejects.toThrow('closed');
    expect(process.stdinEnded).toBe(true);
    expect(process.killSignals).toEqual(['SIGTERM']);
  });
});

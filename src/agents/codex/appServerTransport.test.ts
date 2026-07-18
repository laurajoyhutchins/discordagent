import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AppServerTransport, CodexCliCompatibilityError, type AppServerProcess } from './appServerTransport.js';

class FakeStream extends EventEmitter {
  writeData(value: string) { this.emit('data', Buffer.from(value)); }
}

class FakeProcess extends EventEmitter implements AppServerProcess {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly writes: string[] = [];
  readonly stdin = {
    write: (chunk: string) => { this.writes.push(chunk); return true; },
    end: () => {},
  };
  kill() { return true; }
}

describe('AppServerTransport', () => {
  it('correlates headerless App Server responses and buffers partial lines', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    const promise = transport.request('thread/start', { cwd: '/repo' });
    const request = JSON.parse(process.writes[0]);
    expect(request).toMatchObject({ method: 'thread/start', params: { cwd: '/repo' } });
    expect(request).not.toHaveProperty('jsonrpc');
    process.stdout.writeData(`{"id":${request.id},"res`);
    process.stdout.writeData('ult":{"thread":{"id":"t-1"}}}\n');
    await expect(promise).resolves.toEqual({ thread: { id: 't-1' } });
  });

  it('accepts JSON-RPC headers from tolerant peers but omits them on replies', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    transport.handleServerRequest('approval', async () => ({ decision: 'accept' }));
    process.stdout.writeData('{"jsonrpc":"2.0","id":9,"method":"approval","params":{}}\n');
    await new Promise(resolve => setImmediate(resolve));
    expect(JSON.parse(process.writes.at(-1)!)).toEqual({ id: 9, result: { decision: 'accept' } });
  });

  it('initializes with the client-owned experimental input capability', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    const promise = transport.initialize();
    const request = JSON.parse(process.writes[0]);
    expect(request).toMatchObject({
      method: 'initialize',
      params: {
        clientInfo: { name: 'discord-agent', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    });
    process.stdout.writeData(`{"id":${request.id},"result":{}}\n`);
    await promise;
    expect(JSON.parse(process.writes[1])).toEqual({ method: 'initialized', params: {} });
  });

  it('routes notifications and server requests', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    const notification = new Promise(resolve => transport.once('notification', resolve));
    transport.handleServerRequest('approval', async () => ({ decision: 'accept' }));
    process.stdout.writeData('{"method":"turn/updated","params":{"threadId":"t"}}\n');
    await expect(notification).resolves.toBe('turn/updated');
    process.stdout.writeData('{"id":9,"method":"approval","params":{}}\n');
    await new Promise(resolve => setImmediate(resolve));
    expect(JSON.parse(process.writes.at(-1)!)).toMatchObject({ id: 9, result: { decision: 'accept' } });
  });

  it('rejects pending work on process exit', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    const pending = transport.request('slow');
    process.emit('exit', 1, null);
    await expect(pending).rejects.toThrow('exited');
  });

  it('retries bounded server-overload responses before succeeding', async () => {
    const process = new FakeProcess();
    const delays: number[] = [];
    const transport = new AppServerTransport({
      process,
      overloadRetries: 2,
      overloadBaseDelayMs: 1,
      sleep: async delay => { delays.push(delay); },
    });
    const result = transport.request('thread/start', { cwd: '/repo' });
    const first = JSON.parse(process.writes[0]);
    process.stdout.writeData(`{"id":${first.id},"error":{"code":-32001,"message":"Server overloaded; retry later."}}\n`);
    await new Promise(resolve => setImmediate(resolve));
    const second = JSON.parse(process.writes[1]);
    expect(second.method).toBe('thread/start');
    process.stdout.writeData(`{"id":${second.id},"result":{"thread":{"id":"t-2"}}}\n`);
    await expect(result).resolves.toEqual({ thread: { id: 't-2' } });
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThanOrEqual(1);
  });

  it('classifies model-version incompatibility as a typed error', async () => {
    const process = new FakeProcess();
    const transport = new AppServerTransport({ process });
    const promise = transport.request('thread/start', { model: 'gpt-5.6-luna' });
    const request = JSON.parse(process.writes[0]);
    process.stdout.writeData(`{"id":${request.id},"error":{"code":-32602,"message":"The 'gpt-5.6-luna' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}\n`);

    const error = await promise.catch(value => value);
    expect(error).toBeInstanceOf(CodexCliCompatibilityError);
    expect(error).toMatchObject({
      kind: 'codex_cli_compatibility',
      model: 'gpt-5.6-luna',
      operation: 'thread/start',
    });
  });

});

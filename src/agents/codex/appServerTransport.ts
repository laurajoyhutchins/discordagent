import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redactErrorMessage, redactSensitiveText } from '../../utils/redaction.js';
import { buildProcessInvocation } from '../../utils/processInvocation.js';
import { isRecord, parseJsonRpcLine, type JsonRpcId, type JsonRpcMessage } from './protocol.js';

export interface DataStream { on(event: 'data', listener: (chunk: unknown) => void): unknown; }

export interface AppServerProcess {
  stdin: { write(chunk: string): boolean; end(): void };
  stdout: DataStream;
  stderr: DataStream;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export interface AppServerTransportOptions {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  process?: AppServerProcess;
  spawnProcess?: (command: string, args: readonly string[]) => AppServerProcess;
  overloadRetries?: number;
  overloadBaseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;

export class AppServerRequestError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

export class CodexCliCompatibilityError extends AppServerRequestError {
  readonly kind = 'codex_cli_compatibility' as const;

  constructor(
    code: number,
    message: string,
    readonly model: string,
    readonly operation: string,
  ) {
    super(code, message);
    this.name = 'CodexCliCompatibilityError';
  }
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class AppServerTransport extends EventEmitter {
  private readonly process: AppServerProcess;
  private readonly timeoutMs: number;
  private readonly overloadRetries: number;
  private readonly overloadBaseDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly serverHandlers = new Map<string, ServerRequestHandler>();
  private nextId = 1;
  private stdoutBuffer = '';
  private closed = false;

  constructor(options: AppServerTransportOptions = {}) {
    super();
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.overloadRetries = options.overloadRetries ?? 3;
    this.overloadBaseDelayMs = options.overloadBaseDelayMs ?? 100;
    this.sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
    const spawnProcess = options.spawnProcess ?? ((command, args) => {
      const invocation = buildProcessInvocation(command, args);
      return spawn(invocation.command, invocation.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: process.env,
      }) as ChildProcessWithoutNullStreams;
    });
    this.process = options.process ?? spawnProcess(options.command ?? 'codex', options.args ?? ['app-server']);
    this.process.stdout.on('data', chunk => this.consumeStdout(String(chunk)));
    this.process.stderr.on('data', chunk => {
      const text = redactSensitiveText(String(chunk)).trim();
      if (text) this.emit('stderr', text);
    });
    this.process.once('exit', (code, signal) => this.handleExit(code, signal));
    this.process.on('error', error => this.handleFatal(error));
  }

  async initialize(clientInfo = { name: 'discord-agent', version: '1.0.0' }): Promise<unknown> {
    const result = await this.request('initialize', { clientInfo, capabilities: { experimentalApi: true } });
    this.notify('initialized', {});
    return result;
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce<T>(method, params, timeoutMs);
      } catch (error) {
        if (!(error instanceof AppServerRequestError) || error.code !== -32001 || attempt >= this.overloadRetries) throw error;
        const exponential = this.overloadBaseDelayMs * (2 ** attempt);
        const jitter = Math.floor(Math.random() * Math.max(1, this.overloadBaseDelayMs));
        await this.sleep(exponential + jitter);
      }
    }
  }

  private requestOnce<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex App Server transport is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, timer });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  handleServerRequest(method: string, handler: ServerRequestHandler): () => void {
    this.serverHandlers.set(method, handler);
    return () => this.serverHandlers.delete(method);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex App Server transport closed'));
    }
    this.pending.clear();
    this.process.stdin.end();
    this.process.kill('SIGTERM');
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        void this.route(parseJsonRpcLine(line));
      } catch (error) {
        this.emit('protocolError', new Error(redactErrorMessage(error)));
      }
    }
  }

  private async route(message: JsonRpcMessage): Promise<void> {
    if ('method' in message && 'id' in message) {
      const handler = this.serverHandlers.get(message.method);
      if (!handler) {
        this.write({ id: message.id, error: { code: -32601, message: 'Method not supported' } });
        return;
      }
      try {
        const result = await handler(message.method, message.params);
        this.write({ id: message.id, result });
      } catch (error) {
        this.write({ id: message.id, error: { code: -32000, message: redactErrorMessage(error) } });
      }
      return;
    }
    if ('method' in message) {
      this.emit('notification', message.method, message.params);
      return;
    }
    if ('id' in message) {
      if (message.id === null) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if ('error' in message) {
        const errorMessage = redactSensitiveText(message.error.message);
        pending.reject(classifyCodexAppServerError(message.error.code, errorMessage, pending.method));
      }
      else pending.resolve(message.result);
    }
  }

  private write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.closed) this.handleFatal(new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`));
  }

  private handleFatal(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(redactErrorMessage(error)));
    }
    this.pending.clear();
    this.emit('exit', error);
  }
}

export function classifyCodexAppServerError(code: number, message: string, operation: string): AppServerRequestError {
  const match = message.match(/The ['"]([^'"]+)['"] model requires a newer version of Codex/i);
  return match
    ? new CodexCliCompatibilityError(code, message, match[1]!, operation)
    : new AppServerRequestError(code, message);
}

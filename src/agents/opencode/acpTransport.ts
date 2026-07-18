import { spawn, type SpawnOptions } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
} from '@agentclientprotocol/sdk';
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
import { redactErrorMessage, redactSensitiveText } from '../../utils/redaction.js';

export interface OpenCodeAcpHandlers {
  onSessionUpdate(params: SessionNotification): Promise<void> | void;
  onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  onStderr?(message: string): void;
}

export interface OpenCodeAcpProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export type OpenCodeAcpProcessFactory = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => OpenCodeAcpProcess;

export interface OpenCodeAcpTransportOptions {
  cliPath?: string;
  env?: NodeJS.ProcessEnv;
  process?: OpenCodeAcpProcess;
  spawnProcess?: OpenCodeAcpProcessFactory;
  handlers?: Partial<OpenCodeAcpHandlers>;
}

export interface OpenCodeAcpConnection {
  initialize(): Promise<InitializeResponse>;
  newSession(cwd: string): Promise<NewSessionResponse>;
  loadSession(sessionId: string, cwd: string): Promise<LoadSessionResponse>;
  resumeSession?(sessionId: string, cwd: string): Promise<ResumeSessionResponse>;
  setSessionConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse>;
  prompt(sessionId: string, text: string): Promise<PromptResponse>;
  cancel(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

interface PendingOperation {
  settled: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const noopSessionUpdate = (): void => {};
const cancelledPermission = async (): Promise<RequestPermissionResponse> => ({ outcome: { outcome: 'cancelled' } });

export class OpenCodeAcpTransport implements OpenCodeAcpConnection {
  private readonly process: OpenCodeAcpProcess;
  private readonly handlers: OpenCodeAcpHandlers;
  private readonly connection: ClientConnection;
  private readonly pending = new Set<PendingOperation>();
  private stderrBuffer = '';
  private closed = false;
  private handshake?: InitializeResponse;

  constructor(options: OpenCodeAcpTransportOptions = {}) {
    this.handlers = {
      onSessionUpdate: options.handlers?.onSessionUpdate ?? noopSessionUpdate,
      onPermission: options.handlers?.onPermission ?? cancelledPermission,
      ...(options.handlers?.onStderr ? { onStderr: options.handlers.onStderr } : {}),
    };

    const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, [...args], spawnOptions) as OpenCodeAcpProcess);
    if (options.process) {
      this.process = options.process;
    } else {
      const invocation = buildProcessInvocation(options.cliPath ?? 'opencode', ['acp']);
      this.process = spawnProcess(invocation.command, invocation.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: options.env ?? process.env,
      });
    }

    this.process.stderr.on('data', chunk => {
      this.stderrBuffer += String(chunk);
    });
    this.process.stderr.once('end', () => this.flushStderr());
    this.process.stderr.once('close', () => this.flushStderr());
    this.process.stderr.on('error', error => this.handleProcessFailure(error));
    this.process.stdout.once('end', () => {
      this.handleProcessFailure(new Error('OpenCode ACP stdout closed'));
    });
    this.process.stdout.on('error', error => this.handleProcessFailure(error));
    this.process.once('exit', (code, signal) => {
      this.handleProcessFailure(new Error(`OpenCode ACP process exited (${code ?? signal ?? 'unknown'})`), false);
    });
    this.process.on('error', error => this.handleProcessFailure(error));

    const stream = ndJsonStream(
      Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>,
    );
    const app = client({ name: 'discord-agent' })
      .onRequest(methods.client.session.requestPermission, context => this.handlers.onPermission(context.params))
      .onNotification(methods.client.session.update, context => this.handlers.onSessionUpdate(context.params));
    this.connection = app.connect(stream);
    void this.connection.closed.then(() => {
      if (this.closed) return;
      const reason = this.connection.signal.reason;
      this.handleProcessFailure(reason ?? new Error('OpenCode ACP stream closed'));
    });
  }

  async initialize(): Promise<InitializeResponse> {
    return this.execute(async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'discord-agent', version: '1.0.0' },
        clientCapabilities: {},
      };
      const response = await this.connection.agent.request(methods.agent.initialize, request);
      this.handshake = response;
      return response;
    });
  }

  newSession(cwd: string): Promise<NewSessionResponse> {
    return this.execute(() => this.connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }));
  }

  loadSession(sessionId: string, cwd: string): Promise<LoadSessionResponse> {
    return this.execute(() => this.connection.agent.request(methods.agent.session.load, { sessionId, cwd, mcpServers: [] }));
  }

  resumeSession(sessionId: string, cwd: string): Promise<ResumeSessionResponse> {
    return this.execute(() => this.connection.agent.request(methods.agent.session.resume, { sessionId, cwd, mcpServers: [] }));
  }

  setSessionConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse> {
    const params = typeof value === 'boolean'
      ? { sessionId, configId, type: 'boolean' as const, value }
      : { sessionId, configId, value };
    return this.execute(() => this.connection.agent.request(methods.agent.session.setConfigOption, params));
  }

  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.execute(() => this.connection.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: 'text', text }],
    }));
  }

  cancel(sessionId: string): Promise<void> {
    return this.execute(() => this.connection.agent.notify(methods.agent.session.cancel, { sessionId }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = new Error('OpenCode ACP transport closed');
    this.flushStderr();
    this.rejectPending(error);
    this.connection.close(error);
    this.process.stdin.end();
    this.process.kill('SIGTERM');
  }

  private execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('OpenCode ACP transport is closed'));
    return new Promise<T>((resolve, reject) => {
      const pending: PendingOperation = {
        settled: false,
        resolve: value => resolve(value as T),
        reject,
      };
      this.pending.add(pending);
      let operationPromise: Promise<T>;
      try {
        operationPromise = operation();
      } catch (error) {
        operationPromise = Promise.reject(error);
      }
      void operationPromise
        .then(
          value => this.finish(pending, () => resolve(value)),
          error => this.finish(pending, () => reject(new Error(redactErrorMessage(error)))),
        );
    });
  }

  private finish(pending: PendingOperation, settle: () => void): void {
    if (pending.settled) return;
    pending.settled = true;
    this.pending.delete(pending);
    settle();
  }

  private flushStderr(): void {
    if (!this.stderrBuffer) return;
    const message = redactSensitiveText(this.stderrBuffer).trim();
    this.stderrBuffer = '';
    if (message) this.handlers.onStderr?.(message);
  }

  private handleProcessFailure(error: unknown, terminate = true): void {
    if (this.closed) return;
    this.closed = true;
    this.flushStderr();
    const safeError = new Error(redactErrorMessage(error));
    this.rejectPending(safeError);
    this.connection.close(safeError);
    if (terminate) {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending) {
      if (pending.settled) continue;
      pending.settled = true;
      pending.reject(error);
    }
    this.pending.clear();
  }
}

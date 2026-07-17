import { PROTOCOL_VERSION, type RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type {
  AgentProvider,
  AgentRunHost,
  ContinueTaskInput,
  HandoffEstimate,
  HandoffEstimateInput,
  ProviderAvailability,
  ProviderRun,
  ProviderSession,
  StartTaskInput,
  TaskResult,
} from '../contracts.js';
import type { OpenCodeAcpConnection, OpenCodeAcpHandlers } from './acpTransport.js';
import {
  approvalRequestFromAcp,
  createOpenCodeEventAdapter,
  permissionOutcome,
  taskResultFromPrompt,
} from './opencodeEventAdapter.js';
import { redactErrorMessage, redactTaskResult } from '../../utils/redaction.js';

export interface OpenCodeProviderOptions {
  cliPath: string;
  timeoutMs: number;
  defaultModel?: string;
  resolveProjectModel?: (projectName: string) => string | undefined;
  createConnection: (handlers: OpenCodeAcpHandlers) => Promise<OpenCodeAcpConnection>;
  now?: () => number;
}

interface ActiveRun {
  connection: OpenCodeAcpConnection;
  session: ProviderSession;
  host: AgentRunHost;
  adapter: ReturnType<typeof createOpenCodeEventAdapter>;
  text: string;
  startedAt: number;
  cancelled: boolean;
}

export class OpenCodeProvider implements AgentProvider {
  readonly id = 'opencode' as const;
  private readonly active = new Map<string, ActiveRun>();
  private readonly now: () => number;

  constructor(private readonly options: OpenCodeProviderOptions) {
    this.now = options.now ?? Date.now;
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    let connection: OpenCodeAcpConnection | undefined;
    try {
      connection = await this.options.createConnection({
        onSessionUpdate: () => undefined,
        onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      });
      const response = await this.withTimeout(connection.initialize(), 'initialization');
      if (response.protocolVersion !== PROTOCOL_VERSION) {
        return {
          available: false,
          reason: `OpenCode ACP protocol ${String(response.protocolVersion)} is unsupported; expected v${PROTOCOL_VERSION}.`,
        };
      }
      return { available: true };
    } catch (error) {
      const message = redactErrorMessage(error);
      const authenticationRequired = /auth|login|credential|unauthori[sz]ed|sign.?in/i.test(message);
      return {
        available: false,
        ...(authenticationRequired ? { authenticationRequired: true } : {}),
        reason: `OpenCode ACP unavailable: ${message}`,
      };
    } finally {
      await connection?.close().catch(() => undefined);
    }
  }

  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    return this.openTask(input, host);
  }

  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    if (input.session.provider !== this.id) {
      return Promise.reject(new Error(`Cannot resume ${input.session.provider} session with OpenCode`));
    }
    return this.openTask(input, host, input.session);
  }

  async cancelTask(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.cancelled = true;
    await active.connection.cancel(sessionId).catch(() => undefined);
    await active.connection.close().catch(() => undefined);
    this.active.delete(sessionId);
  }

  async estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate> {
    const characters = input.summaryCharacters || input.transcriptCharacters;
    return {
      estimatedInputTokens: Math.ceil(characters / 4) + input.changedFiles * 150,
      confidence: input.summaryCharacters > 0 ? 'medium' : 'low',
      explanation: input.summaryCharacters > 0
        ? 'Estimate uses the structured handoff summary and changed-file count.'
        : 'Estimate uses the raw transcript because no handoff summary is available.',
    };
  }

  private async openTask(
    input: StartTaskInput | ContinueTaskInput,
    host: AgentRunHost,
    persistedSession?: ProviderSession,
  ): Promise<ProviderRun> {
    let context: ActiveRun | undefined;
    const handlers: OpenCodeAcpHandlers = {
      onSessionUpdate: async params => {
        if (!context) return;
        for (const event of context.adapter.adaptSessionUpdate(params)) {
          if (event.type === 'text_delta') context.text += event.text;
          await context.host.emit(event);
        }
      },
      onPermission: async params => {
        if (!context) return { outcome: { outcome: 'cancelled' } };
        const request = approvalRequestFromAcp(params);
        await context.host.emit({ type: 'approval_request', request });
        const decision = await context.host.requestApproval(request).catch(() => 'timeout' as const);
        const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
        return toPermissionResponse(permissionOutcome(decision, options));
      },
    };

    let connection: OpenCodeAcpConnection | undefined;
    try {
      connection = await this.options.createConnection(handlers);
      const initialized = await this.withTimeout(connection.initialize(), 'initialization');
      ensureProtocol(initialized);

      const model = input.model
        ?? this.options.resolveProjectModel?.(input.projectName)
        ?? this.options.defaultModel;
      let sessionResponse: unknown;
      if (persistedSession) {
        const capabilities = isRecord(initialized.agentCapabilities) ? initialized.agentCapabilities : undefined;
        const sessionCapabilities = isRecord(capabilities?.sessionCapabilities) ? capabilities.sessionCapabilities : undefined;
        if (sessionCapabilities?.resume && connection.resumeSession) {
          sessionResponse = await this.withTimeout(
            connection.resumeSession(persistedSession.sessionId, input.workingDirectory),
            'session resume',
          );
        } else if (capabilities?.loadSession === true) {
          sessionResponse = await this.withTimeout(
            connection.loadSession(persistedSession.sessionId, input.workingDirectory),
            'session load',
          );
        } else {
          throw new Error('OpenCode cannot resume the saved session: ACP resume/load is unavailable');
        }
        validateReturnedSession(sessionResponse, persistedSession.sessionId);
      } else {
        sessionResponse = await this.withTimeout(connection.newSession(input.workingDirectory), 'session creation');
      }

      const sessionId = persistedSession?.sessionId ?? extractSessionId(sessionResponse);
      if (!sessionId) throw new Error('OpenCode ACP did not return a non-empty session identifier');
      const startedAt = this.now();
      const session = persistedSession ?? { provider: this.id, sessionId, createdAt: startedAt };
      if (model) await this.applyModel(connection, sessionId, model, sessionResponse);

      const adapter = createOpenCodeEventAdapter();
      context = {
        connection,
        session,
        host,
        adapter,
        text: '',
        startedAt,
        cancelled: false,
      };
      this.active.set(sessionId, context);
      await host.emit({ type: 'session_started', session });

      const completion = this.complete(input.prompt, context);
      return { session, completion };
    } catch (error) {
      await connection?.close().catch(() => undefined);
      throw new Error(redactErrorMessage(error));
    }
  }

  private async complete(prompt: string, context: ActiveRun): Promise<TaskResult> {
    try {
      const promptResult = await this.withTimeout(
        context.connection.prompt(context.session.sessionId, prompt),
        'prompt',
      );
      const result = taskResultFromPrompt({
        provider: this.id,
        startedAt: context.startedAt,
        completedAt: this.now(),
        sessionId: context.session.sessionId,
        promptResult,
        text: context.text,
      });
      await context.host.emit(result.outcome === 'failed'
        ? { type: 'failed', error: result.error ?? normalizedError('OpenCode prompt failed') }
        : { type: 'completed', result });
      return result;
    } catch (error) {
      const message = redactErrorMessage(error);
      const result = redactTaskResult({
        provider: this.id,
        outcome: context.cancelled ? 'cancelled' : 'failed',
        exitType: context.cancelled ? 'cancelled' : 'error',
        startedAt: context.startedAt,
        completedAt: this.now(),
        sessionId: context.session.sessionId,
        summary: message,
        ...(context.cancelled ? {} : { error: normalizedError(message) }),
      });
      if (context.cancelled) await context.host.emit({ type: 'completed', result });
      else await context.host.emit({ type: 'failed', error: result.error! });
      return result;
    } finally {
      this.active.delete(context.session.sessionId);
      await context.connection.close().catch(() => undefined);
    }
  }

  private async applyModel(
    connection: OpenCodeAcpConnection,
    sessionId: string,
    model: string,
    sessionResponse: unknown,
  ): Promise<void> {
    const options = configOptions(sessionResponse);
    const modelOption = options.find(option => {
      const category = stringValue(option.category);
      return category === 'model' || option.id === 'model';
    });
    const modelId = modelOption ? stringValue(modelOption.id) : undefined;
    if (!modelOption || !modelId || !configValues(modelOption).includes(model)) {
      throw new Error(`OpenCode model "${model}" is not advertised for this session`);
    }
    await this.withTimeout(connection.setSessionConfigOption(sessionId, modelId, model), 'model configuration');
  }

  private async withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    if (!Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`OpenCode ${operation} timed out`)), this.options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function ensureProtocol(response: unknown): void {
  if (!isRecord(response) || response.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`OpenCode ACP protocol ${String(isRecord(response) ? response.protocolVersion : 'unknown')} is unsupported`);
  }
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || value.sessionId.length === 0) return undefined;
  return value.sessionId;
}

function validateReturnedSession(value: unknown, expected: string): void {
  const returned = extractSessionId(value);
  if (returned && returned !== expected) throw new Error('OpenCode returned a different session identifier');
}

function configOptions(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.configOptions)) return [];
  return value.configOptions.filter(isRecord);
}

function configValues(option: Record<string, unknown>): string[] {
  const values = option.options;
  if (!Array.isArray(values)) return [];
  return values.flatMap(value => {
    if (!isRecord(value)) return [];
    if (typeof value.value === 'string') return [value.value];
    if (Array.isArray(value.options)) return value.options.flatMap(nested => isRecord(nested) && typeof nested.value === 'string' ? [nested.value] : []);
    return [];
  });
}

function toPermissionResponse(value: unknown): RequestPermissionResponse {
  if (isRecord(value) && value.outcome === 'selected' && typeof value.optionId === 'string') {
    return { outcome: { outcome: 'selected', optionId: value.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function normalizedError(message: string) {
  return { code: 'opencode_error', message: redactErrorMessage(message), retryable: false } as const;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

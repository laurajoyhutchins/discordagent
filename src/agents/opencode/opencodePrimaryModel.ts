import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { PrimaryModel, PrimaryResponse } from '../../primary/primaryModel.js';
import { buildPrimaryPrompt, parsePrimaryResponse } from '../../primary/primaryModel.js';
import { redactErrorMessage } from '../../utils/redaction.js';
import {
  OpenCodeAcpTransport,
  type OpenCodeAcpConnection,
  type OpenCodeAcpHandlers,
} from './acpTransport.js';
import { createOpenCodeEventAdapter } from './opencodeEventAdapter.js';

const PRIMARY_AGENT_ID = 'discord-agent-primary';
const PRIMARY_RUNTIME_CONFIG = {
  permission: 'deny',
  default_agent: PRIMARY_AGENT_ID,
  agent: {
    [PRIMARY_AGENT_ID]: {
      description: 'Tool-isolated Discord Agent PM coordinator',
      mode: 'primary',
      permission: { '*': 'deny' },
      tools: { '*': false },
    },
  },
  instructions: [],
  plugin: [],
  autoupdate: false,
  share: 'disabled',
  snapshot: false,
} as const;

export interface OpenCodePrimaryModelOptions {
  cliPath?: string;
  workingDirectory?: string;
  model?: string;
  timeoutMs?: number;
  createConnection?: (handlers: OpenCodeAcpHandlers) => Promise<OpenCodeAcpConnection>;
}

export function openCodePrimaryEnvironment(
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(PRIMARY_RUNTIME_CONFIG),
  };
}

export class OpenCodePrimaryModel implements PrimaryModel {
  private readonly timeoutMs: number;
  private readonly createConnection: (handlers: OpenCodeAcpHandlers) => Promise<OpenCodeAcpConnection>;

  constructor(private readonly options: OpenCodePrimaryModelOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.createConnection = options.createConnection ?? (handlers => Promise.resolve(new OpenCodeAcpTransport({
      ...(options.cliPath ? { cliPath: options.cliPath } : {}),
      handlers,
      env: openCodePrimaryEnvironment(),
    })));
  }

  async respond(input: { context: string; message: string }): Promise<PrimaryResponse> {
    let connection: OpenCodeAcpConnection | undefined;
    let text = '';
    const ownsWorkingDirectory = !this.options.workingDirectory;
    const workingDirectory = this.options.workingDirectory
      ?? mkdtempSync(join(tmpdir(), 'discordagent-opencode-pm-'));
    const adapter = createOpenCodeEventAdapter();
    const handlers: OpenCodeAcpHandlers = {
      onSessionUpdate: params => {
        for (const event of adapter.adaptSessionUpdate(params)) {
          if (event.type === 'text_delta') text += event.text;
        }
      },
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    };

    try {
      connection = await this.createConnection(handlers);
      const initialized = await this.withTimeout(connection.initialize(), 'initialization');
      if (initialized.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `OpenCode ACP protocol ${String(initialized.protocolVersion)} is unsupported; expected v${PROTOCOL_VERSION}.`,
        );
      }

      const session = await this.withTimeout(
        connection.newSession(workingDirectory),
        'session creation',
      );
      const sessionId = extractSessionId(session);
      if (!sessionId) throw new Error('OpenCode ACP did not return a primary session identifier');

      if (this.options.model) {
        await this.applyModel(connection, sessionId, this.options.model, session);
      }

      const promptResult = await this.withTimeout(
        connection.prompt(sessionId, buildPrimaryPrompt(input)),
        'prompt',
      );
      const stopReason = isRecord(promptResult) && typeof promptResult.stopReason === 'string'
        ? promptResult.stopReason
        : 'unknown';
      if ((stopReason === 'cancelled' || stopReason === 'refusal') && text.length === 0) {
        throw new Error(`OpenCode primary turn ${stopReason}`);
      }

      return parsePrimaryResponse(text);
    } catch (error) {
      return { reply: `I could not complete the coordination turn: ${redactErrorMessage(error)}` };
    } finally {
      await connection?.close().catch(() => undefined);
      if (ownsWorkingDirectory) {
        rmSync(workingDirectory, { recursive: true, force: true });
      }
    }
  }

  private async applyModel(
    connection: OpenCodeAcpConnection,
    sessionId: string,
    model: string,
    sessionResponse: unknown,
  ): Promise<void> {
    const modelOption = configOptions(sessionResponse).find(option => {
      const category = stringValue(option.category);
      return category === 'model' || option.id === 'model';
    });
    const modelId = modelOption ? stringValue(modelOption.id) : undefined;
    if (!modelOption || !modelId || !configValues(modelOption).includes(model)) {
      throw new Error(`OpenCode model "${model}" is not advertised for the primary session`);
    }
    await this.withTimeout(
      connection.setSessionConfigOption(sessionId, modelId, model),
      'model configuration',
    );
  }

  private async withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`OpenCode primary ${operation} timed out`)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || value.sessionId.length === 0) {
    return undefined;
  }
  return value.sessionId;
}

function configOptions(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.configOptions)) return [];
  return value.configOptions.filter(isRecord);
}

function configValues(option: Record<string, unknown>): string[] {
  if (!Array.isArray(option.options)) return [];
  return option.options.flatMap(value => {
    if (!isRecord(value)) return [];
    if (typeof value.value === 'string') return [value.value];
    if (Array.isArray(value.options)) {
      return value.options.flatMap(nested => (
        isRecord(nested) && typeof nested.value === 'string' ? [nested.value] : []
      ));
    }
    return [];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

import { tmpdir } from 'node:os';
import type { PrimaryModel, PrimaryResponse } from '../../primary/primaryModel.js';
import { buildPrimaryPrompt, parsePrimaryResponse } from '../../primary/primaryModel.js';
import { redactErrorMessage } from '../../utils/redaction.js';
import type { AppServerTransport } from './appServerTransport.js';
import type { CodexAuthService } from './codexAuthService.js';
import { isRecord } from './protocol.js';

export interface CodexPrimaryModelOptions {
  transport: AppServerTransport;
  auth: CodexAuthService;
  workingDirectory?: string;
  model?: string;
  timeoutMs?: number;
}

export class CodexPrimaryModel implements PrimaryModel {
  private readonly workingDirectory: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: CodexPrimaryModelOptions) {
    this.workingDirectory = options.workingDirectory ?? tmpdir();
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async respond(input: { context: string; message: string }): Promise<PrimaryResponse> {
    try {
      const account = await this.options.auth.readAccount();
      if (!account.authenticated) {
        return { reply: 'Codex sign-in is required. Run /codex-auth login, then try again.' };
      }

      const model = this.options.model;
      const thread = await this.options.transport.request('thread/start', {
        cwd: this.workingDirectory,
        ...(model ? { model } : {}),
        approvalPolicy: 'never',
        sandbox: 'readOnly',
        serviceName: 'discord-agent-primary',
      });
      const threadId = extractId(thread, 'thread');
      if (!threadId) throw new Error('Codex App Server did not return a primary thread identifier');

      const responseText = await this.runTurn(threadId, buildPrimaryPrompt(input), model);
      return parsePrimaryResponse(responseText);
    } catch (error) {
      return { reply: `I could not complete the coordination turn: ${redactErrorMessage(error)}` };
    }
  }

  private async runTurn(threadId: string, prompt: string, model?: string): Promise<string> {
    let text = '';
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let dispose = (): void => {};

    const result = new Promise<string>((resolve, reject) => {
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.options.transport.off('notification', onNotification);
        callback();
      };
      const onNotification = (method: string, params: unknown): void => {
        if (!isRecord(params) || params.threadId !== threadId) return;
        if (method === 'item/agentMessage/delta') {
          const delta = params.delta ?? params.text;
          if (typeof delta === 'string') text += delta;
          return;
        }
        if (method === 'turn/completed') {
          const turn = isRecord(params.turn) ? params.turn : params;
          const status = typeof turn.status === 'string' ? turn.status : 'completed';
          if (status === 'completed') finish(() => resolve(text));
          else {
            const error = isRecord(turn.error) ? turn.error : undefined;
            finish(() => reject(new Error(String(error?.message ?? `Codex primary turn ${status}`))));
          }
          return;
        }
        if (method === 'error') {
          const error = isRecord(params.error) ? params.error : params;
          finish(() => reject(new Error(String(error.message ?? 'Codex primary turn failed'))));
        }
      };
      dispose = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.options.transport.off('notification', onNotification);
      };
      this.options.transport.on('notification', onNotification);
      timer = setTimeout(() => {
        finish(() => reject(new Error('Codex primary turn timed out')));
        void this.options.transport.request('turn/interrupt', { threadId }).catch(() => undefined);
      }, this.timeoutMs);
    });

    try {
      await this.options.transport.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        cwd: this.workingDirectory,
        ...(model ? { model } : {}),
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      });
      return await result;
    } catch (error) {
      dispose();
      throw error;
    }
  }
}

function extractId(value: unknown, nested: 'thread'): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id === 'string') return value.id;
  if (typeof value.threadId === 'string') return value.threadId;
  const object = value[nested];
  return isRecord(object) && typeof object.id === 'string' ? object.id : undefined;
}

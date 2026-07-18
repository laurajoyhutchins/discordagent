import { isAbsolute, relative, resolve } from 'node:path';
import type {
  AgentProvider, AgentRunHost, ContinueTaskInput, HandoffEstimate, HandoffEstimateInput,
  ProviderAvailability, ProviderRun, StartTaskInput, TaskResult,
} from '../contracts.js';
import { normalizeAgentTaskSettings, validateSupportedAgentSettings } from '../contracts.js';
import { redactErrorMessage } from '../../utils/redaction.js';
import type { AppServerTransport } from './appServerTransport.js';
import type { CodexAuthService } from './codexAuthService.js';
import { adaptCodexNotification } from './codexEventAdapter.js';
import { isRecord } from './protocol.js';

interface ActiveTurn {
  threadId: string;
  turnId?: string;
  workingDirectory: string;
  host: AgentRunHost;
  startedAt: number;
  resolve(result: TaskResult): void;
  reject(error: Error): void;
}

export interface CodexProviderOptions {
  transport: AppServerTransport;
  auth: CodexAuthService;
}

const THREAD_POLICY = {
  approvalPolicy: 'onRequest',
  sandbox: 'workspaceWrite',
  serviceName: 'discord-agent',
} as const;

export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const;
  private readonly active = new Map<string, ActiveTurn>();
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly options: CodexProviderOptions) {
    const onNotification = (method: string, params: unknown) => void this.handleNotification(method, params);
    options.transport.on('notification', onNotification);
    this.unsubs.push(() => options.transport.off('notification', onNotification));
    this.installServerHandlers();
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    try {
      const account = await this.options.auth.readAccount();
      return account.authenticated
        ? { available: true }
        : { available: false, authenticationRequired: true, reason: 'Codex sign-in is required. Run /codex-auth login.' };
    } catch (error) {
      return { available: false, reason: `Codex App Server unavailable: ${redactErrorMessage(error)}` };
    }
  }

  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    return this.startOrContinue(input, host);
  }

  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    return this.startOrContinue(input, host, input.session.sessionId);
  }

  async cancelTask(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    await this.options.transport.request('turn/interrupt', {
      threadId: sessionId,
      ...(active?.turnId ? { turnId: active.turnId } : {}),
    }).catch(() => undefined);
  }

  async estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate> {
    const chars = input.summaryCharacters + Math.min(input.transcriptCharacters, 12_000) + input.changedFiles * 300;
    return {
      estimatedInputTokens: Math.max(1, Math.ceil(chars / 4)),
      confidence: input.transcriptCharacters <= 20_000 ? 'medium' : 'low',
      explanation: 'Estimated target-provider input context; excludes future tool output and responses.',
    };
  }

  async close(): Promise<void> {
    this.unsubs.splice(0).forEach(fn => fn());
    for (const active of this.active.values()) active.reject(new Error('Codex provider closed'));
    this.active.clear();
  }

  private async startOrContinue(input: StartTaskInput | ContinueTaskInput, host: AgentRunHost, existingThreadId?: string): Promise<ProviderRun> {
    const settings = normalizeAgentTaskSettings(input);
    validateSupportedAgentSettings(this.id, settings, 'task');
    if ('turnSettings' in input && input.turnSettings) {
      validateSupportedAgentSettings(this.id, input.turnSettings, 'turn');
    }
    const turnSettings = ('turnSettings' in input && input.turnSettings)
      ? { ...settings, ...input.turnSettings }
      : settings;
    const model = settings.model;
    const reasoningEffort = settings.reasoningEffort;
    const turnModel = turnSettings.model;
    const turnReasoningEffort = turnSettings.reasoningEffort;
    const threadParams = {
      ...(existingThreadId ? { threadId: existingThreadId } : {}),
      cwd: input.workingDirectory,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      ...THREAD_POLICY,
    };
    const threadResponse = await this.options.transport.request(existingThreadId ? 'thread/resume' : 'thread/start', threadParams);
    const threadId = extractId(threadResponse, 'thread');
    if (!threadId) throw new Error('Codex App Server did not return a thread identifier');
    if (existingThreadId && threadId !== existingThreadId) throw new Error('Codex App Server resumed a different thread');

    const startedAt = Date.now();
    const session = { provider: 'codex' as const, sessionId: threadId, createdAt: startedAt };
    await host.emit({ type: 'session_started', session });

    let resolveCompletion!: (result: TaskResult) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<TaskResult>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    const active: ActiveTurn = {
      threadId,
      workingDirectory: input.workingDirectory,
      host,
      startedAt,
      resolve: resolveCompletion,
      reject: rejectCompletion,
    };
    this.active.set(threadId, active);
    try {
      const response = await this.options.transport.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: input.prompt }],
        cwd: input.workingDirectory,
        ...(turnModel ? { model: turnModel } : {}),
        ...(turnReasoningEffort ? { effort: turnReasoningEffort } : {}),
        approvalPolicy: 'onRequest',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [input.workingDirectory],
          networkAccess: false,
        },
      });
      active.turnId = extractId(response, 'turn');
    } catch (error) {
      this.active.delete(threadId);
      throw error;
    }
    return { session, completion };
  }

  private async handleNotification(method: string, params: unknown): Promise<void> {
    const adapted = adaptCodexNotification(method, params);
    if (!adapted.threadId) return;
    const active = this.active.get(adapted.threadId);
    if (!active) return;
    for (const event of adapted.events) await active.host.emit(event);
    if (adapted.terminal) {
      this.active.delete(adapted.threadId);
      active.resolve({ ...adapted.terminal, startedAt: active.startedAt, sessionId: active.threadId });
    }
  }

  private installServerHandlers(): void {
    const approval = async (method: string, params: unknown) => {
      const p = isRecord(params) ? params : {};
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      const active = this.active.get(threadId);
      if (!active) return { decision: 'decline' };
      const fileChange = /file/i.test(method);
      const network = isRecord(p.networkApprovalContext);
      const decision = await active.host.requestApproval({
        id: String(p.itemId ?? p.requestId ?? p.id ?? Date.now()),
        kind: fileChange ? 'file_change' : 'command',
        title: network ? 'Allow Codex network access?' : fileChange ? 'Apply file changes?' : 'Run command?',
        details: approvalDetails(p),
        risk: network ? 'high' : 'medium',
      });
      return { decision: decision === 'allow' ? 'accept' : decision === 'timeout' ? 'cancel' : 'decline' };
    };
    for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
      this.unsubs.push(this.options.transport.handleServerRequest(method, approval));
    }

    this.unsubs.push(this.options.transport.handleServerRequest('item/permissions/requestApproval', async (_method, params) => {
      const p = isRecord(params) ? params : {};
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      const active = this.active.get(threadId);
      if (!active) return { permissions: {}, scope: 'turn' };
      const requested = isRecord(p.permissions) ? p.permissions : {};
      const decision = await active.host.requestApproval({
        id: String(p.itemId ?? p.requestId ?? p.id ?? Date.now()),
        kind: 'tool',
        title: 'Grant additional Codex permissions?',
        details: String(p.reason ?? JSON.stringify(requested)),
        risk: 'high',
      });
      return {
        permissions: decision === 'allow' ? filterPermissions(requested, active.workingDirectory) : {},
        scope: 'turn',
      };
    }));

    this.unsubs.push(this.options.transport.handleServerRequest('item/tool/requestUserInput', async (_method, params) => {
      const p = isRecord(params) ? params : {};
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      const active = this.active.get(threadId);
      if (!active) return { answers: {} };

      const questions = Array.isArray(p.questions) ? p.questions.filter(isRecord) : [];
      const answers: Record<string, { answers: string[] }> = {};
      for (const question of questions) {
        const questionId = typeof question.id === 'string' ? question.id : String(Date.now());
        if (question.isSecret === true) {
          await active.host.emit({
            type: 'status',
            phase: 'Secret input required',
            detail: 'Codex requested secret input. Enter it locally; secrets are never collected through Discord.',
          });
          answers[questionId] = { answers: [] };
          continue;
        }
        const options = Array.isArray(question.options)
          ? question.options.flatMap(option => isRecord(option) && typeof option.label === 'string'
            ? [{ label: option.label, value: option.label }]
            : [])
          : undefined;
        const answer = await active.host.requestUserInput({
          id: questionId,
          prompt: [question.header, question.question]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n') || 'Codex needs input',
          ...(options?.length ? { options } : {}),
          allowFreeText: question.isOther === true || !options?.length,
        });
        answers[questionId] = { answers: answer.skipped ? [] : answer.values };
      }
      return { answers };
    }));
  }
}

function approvalDetails(params: Record<string, unknown>): string {
  if (isRecord(params.networkApprovalContext)) {
    const host = String(params.networkApprovalContext.host ?? 'unknown host');
    const protocol = String(params.networkApprovalContext.protocol ?? 'network');
    return `${protocol} access to ${host}`;
  }
  return String(params.command ?? params.reason ?? params.diff ?? params.details ?? 'No additional details supplied.');
}

function filterPermissions(requested: Record<string, unknown>, workingDirectory: string): Record<string, unknown> {
  const granted: Record<string, unknown> = {};
  if (isRecord(requested.network)) granted.network = requested.network;
  if (isRecord(requested.fileSystem)) {
    const fileSystem: Record<string, unknown> = {};
    for (const key of ['read', 'write'] as const) {
      if (!Array.isArray(requested.fileSystem[key])) continue;
      const roots = requested.fileSystem[key].filter((value): value is string => typeof value === 'string' && isWithin(workingDirectory, value));
      if (roots.length) fileSystem[key] = roots;
    }
    if (Object.keys(fileSystem).length) granted.fileSystem = fileSystem;
  }
  return granted;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function extractId(value: unknown, nested: 'thread' | 'turn'): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id === 'string') return value.id;
  if (typeof value[`${nested}Id`] === 'string') return value[`${nested}Id`] as string;
  const object = value[nested];
  return isRecord(object) && typeof object.id === 'string' ? object.id : undefined;
}

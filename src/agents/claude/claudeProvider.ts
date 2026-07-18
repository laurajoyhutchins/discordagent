import {
  query as sdkQuery,
  type CanUseTool,
  type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentEvent,
  AgentProvider,
  AgentRunHost,
  ApprovalRequest,
  ContinueTaskInput,
  HandoffEstimate,
  HandoffEstimateInput,
  ProviderAvailability,
  ProviderRun,
  ProviderSession,
  StartTaskInput,
  TaskResult,
  UserQuestion,
  HostMcpServers,
} from '../contracts.js';
import { normalizeAgentTaskSettings, validateSupportedAgentSettings } from '../contracts.js';
import {
  adaptClaudeMessage,
  classifyClaudeError,
} from './claudeEventAdapter.js';
import { safeStringify } from '../../utils/redaction.js';

export type ClaudeQueryRequest = Parameters<typeof sdkQuery>[0];
export type ClaudeQueryFunction = (request: ClaudeQueryRequest) => AsyncIterable<unknown>;

export interface ClaudeProviderOptions {
  queryFn?: ClaudeQueryFunction;
  resolveMcpServers: (profile?: string) => HostMcpServers | undefined;
  env?: Record<string, string | undefined>;
  onRateLimit?: (info: Record<string, unknown>) => void;
  onSessionResult?: (projectName: string, result: Record<string, unknown>) => Promise<void> | void;
  now?: () => number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  settled(): boolean;
}

const AUTO_APPROVED_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoRead', 'TodoWrite',
]);
const AUTO_APPROVED_PREFIXES = ['mcp__playwright__'];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const HAS_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let isSettled = false;
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(value: T): void {
      if (isSettled) return;
      isSettled = true;
      resolvePromise(value);
    },
    reject(error: unknown): void {
      if (isSettled) return;
      isSettled = true;
      rejectPromise(error);
    },
    settled(): boolean { return isSettled; },
  };
}

function sanitizePrompt(prompt: string): string {
  return prompt.replace(LONE_SURROGATE, '\uFFFD');
}

function cleanEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'CLAUDECODE' || value === undefined || HAS_LONE_SURROGATE.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function toolPreviewEvent(toolName: string, input: Record<string, unknown>): AgentEvent {
  if (toolName === 'Bash') {
    return { type: 'command', command: String(input.command ?? ''), state: 'requested' };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const path = String(input.file_path ?? input.path ?? 'unknown');
    return { type: 'file_change', paths: [path], summary: safeStringify(input) };
  }
  return { type: 'status', phase: `tool:${toolName}`, detail: safeStringify(input) };
}

function questionsFromInput(input: Record<string, unknown>, toolUseId: string): UserQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((candidate, index) => {
    const question = record(candidate);
    if (!question || typeof question.question !== 'string') return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap(optionCandidate => {
        const option = record(optionCandidate);
        if (!option || typeof option.label !== 'string') return [];
        return [{
          label: option.label,
          value: option.label,
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        }];
      })
      : undefined;
    return [{
      id: `${toolUseId}-${index}`,
      prompt: question.question,
      ...(options && options.length > 0 ? { options } : { allowFreeText: true }),
    }];
  });
}

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const;
  private readonly queryFn: ClaudeQueryFunction;
  private readonly now: () => number;
  private readonly environment: Record<string, string>;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly options: ClaudeProviderOptions) {
    this.queryFn = options.queryFn ?? ((request: ClaudeQueryRequest) => sdkQuery(request));
    this.now = options.now ?? Date.now;
    this.environment = cleanEnvironment(options.env ?? process.env);
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    return { available: true };
  }

  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    return this.execute(input, host);
  }

  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun> {
    if (input.session.provider !== this.id) {
      return Promise.reject(new Error(`Cannot resume ${input.session.provider} session with Claude`));
    }
    return this.execute(input, host, input.session);
  }

  async cancelTask(sessionId: string): Promise<void> {
    this.controllers.get(sessionId)?.abort();
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

  private async execute(
    input: StartTaskInput | ContinueTaskInput,
    host: AgentRunHost,
    resumedSession?: ProviderSession,
  ): Promise<ProviderRun> {
    const settings = normalizeAgentTaskSettings(input);
    validateSupportedAgentSettings(this.id, settings, 'task');
    if ('turnSettings' in input && input.turnSettings) {
      validateSupportedAgentSettings(this.id, input.turnSettings, 'turn');
    }
    const turnSettings = ('turnSettings' in input && input.turnSettings)
      ? { ...settings, ...input.turnSettings }
      : settings;
    const startedAt = this.now();
    const abortController = new AbortController();
    const sessionDeferred = deferred<ProviderSession>();
    let activeSession = resumedSession;
    let finalResult: TaskResult | undefined;

    this.controllers.set(input.taskId, abortController);
    if (resumedSession) {
      this.controllers.set(resumedSession.sessionId, abortController);
      sessionDeferred.resolve(resumedSession);
    }

    const completion = (async (): Promise<TaskResult> => {
      const timeout = turnSettings.timeoutMs === undefined
        ? undefined
        : setTimeout(() => abortController.abort(), turnSettings.timeoutMs);
      try {
        if (resumedSession) {
          await host.emit({ type: 'session_started', session: resumedSession });
        }

        const model = turnSettings.model;
        const request: ClaudeQueryRequest = {
          prompt: sanitizePrompt(input.prompt),
          options: {
            cwd: input.workingDirectory,
            abortController,
            permissionMode: 'default',
            settingSources: ['user'],
            ...(() => {
              const mcpProfile = settings.mcpProfile;
              const mcpServers = this.options.resolveMcpServers(mcpProfile);
              const unknownProfile = typeof mcpProfile === 'string' && mcpProfile.trim().length > 0 && mcpServers === undefined;
              return mcpServers !== undefined || unknownProfile
                ? { mcpServers: (mcpServers ?? {}) as Record<string, McpServerConfig> }
                : {};
            })(),
            ...(model ? { model } : {}),
            env: this.environment,
            ...(resumedSession ? { resume: resumedSession.sessionId } : {}),
            canUseTool: this.makeCanUseTool(host),
          },
        };

        const stream = this.queryFn(request);
        for await (const message of stream) {
          const adaptation = adaptClaudeMessage(message, { startedAt, now: this.now });
          if (adaptation.session && !activeSession) {
            activeSession = adaptation.session;
            this.controllers.set(activeSession.sessionId, abortController);
            sessionDeferred.resolve(activeSession);
            await host.emit({ type: 'session_started', session: activeSession });
          }
          if (adaptation.rateLimitInfo) {
            this.options.onRateLimit?.(adaptation.rateLimitInfo);
          }
          if (adaptation.rawResult) {
            await this.options.onSessionResult?.(input.projectName, adaptation.rawResult);
          }
          for (const event of adaptation.events) await host.emit(event);
          if (adaptation.result) finalResult = adaptation.result;
        }

        if (finalResult) return finalResult;
        if (!activeSession) {
          const error = new Error('Claude SDK stream ended before supplying a session ID');
          sessionDeferred.reject(error);
          const normalized = classifyClaudeError(error);
          await host.emit({ type: 'failed', error: normalized });
          return {
            provider: this.id,
            outcome: 'failed',
            exitType: 'error',
            startedAt,
            completedAt: this.now(),
            summary: normalized.message,
            error: normalized,
          };
        }
        const interrupted: TaskResult = {
          provider: this.id,
          outcome: 'interrupted',
          exitType: 'interrupted',
          startedAt,
          completedAt: this.now(),
          ...(activeSession ? { sessionId: activeSession.sessionId } : {}),
          summary: 'Claude stream ended before a terminal result.',
        };
        await host.emit({ type: 'completed', result: interrupted });
        return interrupted;
      } catch (error) {
        const cancelled = abortController.signal.aborted;
        const normalized = classifyClaudeError(error);
        const result: TaskResult = {
          provider: this.id,
          outcome: cancelled ? 'cancelled' : 'failed',
          exitType: cancelled ? 'cancelled' : 'error',
          startedAt,
          completedAt: this.now(),
          ...(activeSession ? { sessionId: activeSession.sessionId } : {}),
          summary: normalized.message,
          ...(cancelled ? {} : { error: normalized }),
        };
        if (!sessionDeferred.settled()) sessionDeferred.reject(error);
        if (cancelled) await host.emit({ type: 'completed', result });
        else await host.emit({ type: 'failed', error: normalized });
        return result;
      } finally {
        if (timeout) clearTimeout(timeout);
        this.controllers.delete(input.taskId);
        if (activeSession && this.controllers.get(activeSession.sessionId) === abortController) {
          this.controllers.delete(activeSession.sessionId);
        }
      }
    })();

    const session = await sessionDeferred.promise;
    return { session, completion };
  }

  private makeCanUseTool(host: AgentRunHost): CanUseTool {
    return async (toolName, input, context) => {
      if (toolName === 'AskUserQuestion') {
        const answers: Record<string, string> = {};
        const questions = questionsFromInput(input, context.toolUseID);
        for (const question of questions) {
          await host.emit({ type: 'user_question', question });
          const answer = await host.requestUserInput(question);
          answers[question.prompt] = answer.skipped ? 'skip' : answer.values[0] ?? 'skip';
        }
        return {
          behavior: 'allow',
          updatedInput: { questions: input.questions, answers },
        };
      }

      await host.emit(toolPreviewEvent(toolName, input));
      if (AUTO_APPROVED_TOOLS.has(toolName)
        || AUTO_APPROVED_PREFIXES.some(prefix => toolName.startsWith(prefix))) {
        return { behavior: 'allow', updatedInput: input };
      }

      const request: ApprovalRequest = {
        id: context.toolUseID,
        kind: toolName === 'Bash'
          ? 'command'
          : toolName === 'Edit' || toolName === 'Write'
            ? 'file_change'
            : 'tool',
        title: toolName,
        details: safeStringify(input),
      };
      await host.emit({ type: 'approval_request', request });
      const decision = await host.requestApproval(request);
      return decision === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: decision === 'timeout' ? 'Approval timed out.' : 'User denied this tool use.' };
    };
  }
}

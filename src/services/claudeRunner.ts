import type { AnyThreadChannel, Message } from 'discord.js';
import type {
  AgentEvent,
  AgentRunHost,
  ApprovalRequest,
  ProviderSession,
  TaskResult,
  UserAnswer,
  UserQuestion,
} from '../agents/contracts.js';
import { ClaudeProvider } from '../agents/claude/claudeProvider.js';
import { config } from '../config.js';
import type { ActiveSession } from '../types.js';
import { DiscordStreamer } from './discordStreamer.js';
import { getProject, updateProjectSession } from './projectStore.js';
import { captureRateLimitEvent, captureSessionResult } from './usageTracker.js';

interface LegacyResult {
  exitType: string;
  cost?: number;
  duration?: number;
  sessionId?: string;
}

const activeSessions = new Map<string, ActiveSession>();

const claudeProvider = new ClaudeProvider({
  timeoutMs: config.claudeTimeoutMs,
  mcpServers: config.mcpServers,
  defaultModel: config.defaultModel,
  resolveProjectModel: projectName => getProject(projectName)?.models?.claude,
  onRateLimit: captureRateLimitEvent,
  onSessionResult: captureSessionResult,
});

function threadLabel(prompt: string): string {
  return prompt.slice(0, 85);
}

async function setThreadName(thread: AnyThreadChannel, name: string): Promise<void> {
  try { await thread.setName(name.slice(0, 100)); } catch {}
}

function parseInput(details: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(details) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toolNameForFileEvent(event: Extract<AgentEvent, { type: 'file_change' }>): string {
  const input = event.summary ? parseInput(event.summary) : {};
  return input.old_string !== undefined || input.new_string !== undefined ? 'Edit' : 'Write';
}

function createHost(streamer: DiscordStreamer): AgentRunHost {
  return {
    async emit(event: AgentEvent): Promise<void> {
      switch (event.type) {
        case 'text_delta':
          streamer.append(event.text);
          break;
        case 'command':
          await streamer.sendToolUseEmbed('Bash', { command: event.command });
          break;
        case 'file_change': {
          const input = event.summary ? parseInput(event.summary) : {};
          await streamer.sendToolUseEmbed(toolNameForFileEvent(event), {
            ...input,
            file_path: input.file_path ?? input.path ?? event.paths[0],
          });
          break;
        }
        case 'status':
          if (event.phase.startsWith('tool:')) {
            await streamer.sendToolUseEmbed(
              event.phase.slice('tool:'.length),
              event.detail ? parseInput(event.detail) : {},
            );
          }
          break;
        case 'session_started':
        case 'plan':
        case 'approval_request':
        case 'user_question':
        case 'usage':
        case 'completed':
        case 'failed':
          break;
      }
    },

    async requestApproval(request: ApprovalRequest) {
      const decision = await streamer.promptToolApproval(request.title, parseInput(request.details));
      return decision;
    },

    async requestUserInput(question: UserQuestion): Promise<UserAnswer> {
      const answers = await streamer.promptAskUserQuestion([{
        question: question.prompt,
        ...(question.options && question.options.length > 0
          ? {
            options: question.options.map(option => ({
              label: option.value,
              description: option.description ?? option.label,
            })),
          }
          : {}),
      }]);
      const value = answers[question.prompt] ?? 'skip';
      return { skipped: value === 'skip', values: value === 'skip' ? [] : [value] };
    },
  };
}

function legacyResult(result: TaskResult): LegacyResult {
  return {
    exitType: result.exitType,
    ...(result.costUsd === undefined ? {} : { cost: result.costUsd }),
    ...(result.durationMs === undefined ? {} : { duration: result.durationMs }),
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
  };
}

function failedResult(error: unknown, startedAt: number, sessionId?: string): TaskResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    provider: 'claude',
    outcome: message.toLowerCase().includes('abort') ? 'cancelled' : 'failed',
    exitType: message.toLowerCase().includes('abort') ? 'cancelled' : 'error',
    startedAt,
    completedAt: Date.now(),
    ...(sessionId ? { sessionId } : {}),
    summary: message,
    ...(message.toLowerCase().includes('abort')
      ? {}
      : { error: { code: 'claude_provider_error', message, retryable: false } }),
  };
}

async function executeInThread(input: {
  prompt: string;
  projectDir: string;
  projectName: string;
  thread: AnyThreadChannel;
  streamer: DiscordStreamer;
  reactMessage: Message | null;
  existingSessionId?: string;
  model?: string;
}): Promise<TaskResult> {
  const { thread } = input;
  const startedAt = Date.now();
  const activeSession: ActiveSession = {
    abortController: new AbortController(),
    channelId: thread.parentId!,
    threadId: thread.id,
    projectName: input.projectName,
    sessionId: input.existingSessionId ?? null,
    startedAt,
    busy: true,
  };
  activeSessions.set(thread.id, activeSession);

  const host = createHost(input.streamer);
  const taskInput = {
    taskId: thread.id,
    projectName: input.projectName,
    workingDirectory: input.projectDir,
    channelId: thread.parentId!,
    threadId: thread.id,
    prompt: input.prompt,
    ...(input.model ? { model: input.model } : {}),
  };

  async function runOnce(session?: ProviderSession): Promise<TaskResult> {
    const run = session
      ? await claudeProvider.continueTask({ ...taskInput, session }, host)
      : await claudeProvider.startTask(taskInput, host);
    activeSession.sessionId = run.session.sessionId;
    updateProjectSession(input.projectName, run.session.sessionId);
    return run.completion;
  }

  try {
    const resumeSession = input.existingSessionId
      ? {
        provider: 'claude' as const,
        sessionId: input.existingSessionId,
        createdAt: activeSession.startedAt,
      }
      : undefined;
    let result = await runOnce(resumeSession);

    if (resumeSession && result.error?.code === 'session_encoding_error') {
      console.warn(
        `[claudeRunner] Session ${resumeSession.sessionId} has encoding errors, clearing and retrying fresh`,
      );
      updateProjectSession(input.projectName, '');
      activeSession.sessionId = null;
      input.streamer.append('\n⚠️ Session history corrupted — starting fresh session\n');
      result = await runOnce();
    }

    activeSession.busy = false;
    await input.streamer.finish(legacyResult(result));
    if (input.reactMessage) {
      try {
        const emoji = result.outcome === 'completed'
          ? '✅'
          : result.outcome === 'cancelled'
            ? '🛑'
            : '❌';
        await input.reactMessage.react(emoji);
      } catch {}
    }
    return result;
  } catch (error) {
    activeSession.busy = false;
    const result = failedResult(error, startedAt, activeSession.sessionId ?? undefined);
    if (result.outcome !== 'cancelled') input.streamer.append(`\n[error] ${result.summary}\n`);
    await input.streamer.finish(legacyResult(result));
    if (input.reactMessage) {
      try { await input.reactMessage.react(result.outcome === 'cancelled' ? '🛑' : '❌'); } catch {}
    }
    return result;
  }
}

export function getSession(threadId: string): ActiveSession | undefined {
  return activeSessions.get(threadId);
}

export function hasSession(threadId: string): boolean {
  return activeSessions.has(threadId);
}

export function getSessionsByChannel(channelId: string): ActiveSession[] {
  return [...activeSessions.values()].filter(session => session.channelId === channelId);
}

export function hasActiveSessions(channelId: string): boolean {
  return getSessionsByChannel(channelId).some(session => session.busy);
}

export async function runClaude(
  prompt: string,
  projectDir: string,
  projectName: string,
  originalMessage: Message,
  existingSessionId?: string,
  model?: string,
): Promise<void> {
  const thread = await originalMessage.startThread({
    name: `⏳ ${threadLabel(prompt)}`,
    autoArchiveDuration: 60,
  });
  const streamer = new DiscordStreamer(thread);
  streamer.start();
  const result = await executeInThread({
    prompt,
    projectDir,
    projectName,
    thread,
    streamer,
    reactMessage: originalMessage,
    existingSessionId,
    model,
  });
  const prefix = result.outcome === 'completed' ? '✅' : result.outcome === 'cancelled' ? '🛑' : '❌';
  await setThreadName(thread, `${prefix} ${threadLabel(prompt)}`);
}

export async function runClaudeInThread(
  prompt: string,
  projectDir: string,
  projectName: string,
  thread: AnyThreadChannel,
  existingSessionId?: string,
  model?: string,
): Promise<LegacyResult | null> {
  const existing = activeSessions.get(thread.id);
  if (existing?.busy) {
    await thread.send('⚠️ Claude is still working on the previous query. Waiting...');
    return null;
  }

  const streamer = new DiscordStreamer(thread);
  streamer.start();
  const result = await executeInThread({
    prompt,
    projectDir,
    projectName,
    thread,
    streamer,
    reactMessage: null,
    existingSessionId: existing?.sessionId ?? existingSessionId,
    model,
  });
  return legacyResult(result);
}

export async function continueInThread(
  prompt: string,
  projectDir: string,
  projectName: string,
  message: Message,
  model?: string,
): Promise<void> {
  const thread = message.channel as AnyThreadChannel;
  const session = activeSessions.get(thread.id);
  if (session?.busy) {
    await message.reply('Claude is still working. Wait for it to finish or use `/cancel`.');
    return;
  }
  const resumeId = session?.sessionId ?? undefined;
  if (!resumeId) {
    await message.reply('No session to continue. Start a new prompt in the main channel.');
    return;
  }

  const currentName = thread.name.replace(/^[⏳✅❌🛑🔁]+\s*/, '');
  await setThreadName(thread, `⏳ ${currentName}`);
  const streamer = new DiscordStreamer(thread);
  streamer.start();
  const result = await executeInThread({
    prompt,
    projectDir,
    projectName,
    thread,
    streamer,
    reactMessage: message,
    existingSessionId: resumeId,
    model,
  });
  const prefix = result.outcome === 'completed' ? '✅' : result.outcome === 'cancelled' ? '🛑' : '❌';
  await setThreadName(thread, `${prefix} ${currentName}`);
}

export async function cancelSession(threadId: string): Promise<boolean> {
  const session = activeSessions.get(threadId);
  if (!session) return false;
  await claudeProvider.cancelTask(session.sessionId ?? threadId);
  session.busy = false;
  return true;
}

export async function cancelAllForChannel(channelId: string): Promise<number> {
  const sessions = getSessionsByChannel(channelId).filter(session => session.busy);
  await Promise.all(sessions.map(session => claudeProvider.cancelTask(session.sessionId ?? session.threadId)));
  for (const session of sessions) session.busy = false;
  return sessions.length;
}

export function clearSession(threadId: string): void {
  activeSessions.delete(threadId);
}

export function getAllSessions(): Map<string, ActiveSession> {
  return activeSessions;
}

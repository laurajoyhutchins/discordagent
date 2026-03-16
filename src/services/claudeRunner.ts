import { query } from '@anthropic-ai/claude-agent-sdk';
import { Message, AnyThreadChannel } from 'discord.js';
import { config } from '../config.js';
import { DiscordStreamer } from './discordStreamer.js';
import { updateProjectSession } from './projectStore.js';
import { captureRateLimitEvent, captureSessionResult } from './usageTracker.js';
import type { ActiveSession } from '../types.js';

// Sessions keyed by THREAD ID — allows multiple concurrent threads per channel
const activeSessions = new Map<string, ActiveSession>();

// Regex matching lone (unpaired) Unicode surrogates — these break JSON serialization.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Strip lone surrogates from a string to prevent JSON serialization errors.
 * Discord messages and file contents can contain broken Unicode that the API rejects.
 */
function sanitize(text: string): string {
  return text.replace(LONE_SURROGATE, '\uFFFD');
}

// Build a clean env object once at startup: exclude CLAUDECODE and any values
// with unpaired Unicode surrogates.
const cleanEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => k !== 'CLAUDECODE' && v != null && !LONE_SURROGATE.test(v)
  ) as [string, string][]
);

// Tools that are auto-approved (read-only, no side effects)
const AUTO_APPROVED_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'TodoRead', 'TodoWrite',
];

// Tool name prefixes that are auto-approved (e.g. MCP server tools)
const AUTO_APPROVED_PREFIXES = [
  'mcp__playwright__',
];

// ── Thread naming helpers ──────────────────────────────────────────────
// Discord rate-limits thread renames to ~2 per 10 min. We rename on
// create and on finish only — never mid-stream.

function threadLabel(prompt: string): string {
  return prompt.slice(0, 85);
}

async function setThreadName(thread: AnyThreadChannel, name: string): Promise<void> {
  try { await thread.setName(name.slice(0, 100)); } catch {}
}

// ── Public API ─────────────────────────────────────────────────────────

export function getSession(threadId: string): ActiveSession | undefined {
  return activeSessions.get(threadId);
}

export function hasSession(threadId: string): boolean {
  return activeSessions.has(threadId);
}

export function getSessionsByChannel(channelId: string): ActiveSession[] {
  return [...activeSessions.values()].filter(s => s.channelId === channelId);
}

export function hasActiveSessions(channelId: string): boolean {
  return getSessionsByChannel(channelId).some(s => s.busy);
}

// ── Tool approval wiring ───────────────────────────────────────────────

function makeCanUseTool(streamer: DiscordStreamer) {
  return async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'AskUserQuestion') {
      const questions = (input as any).questions ?? [];
      const answers = await streamer.promptAskUserQuestion(questions);
      return {
        behavior: 'allow' as const,
        updatedInput: { questions: (input as any).questions, answers },
      };
    }

    if (AUTO_APPROVED_TOOLS.includes(toolName) || AUTO_APPROVED_PREFIXES.some(p => toolName.startsWith(p))) {
      await streamer.sendToolUseEmbed(toolName, input);
      return { behavior: 'allow' as const, updatedInput: input };
    }

    await streamer.sendToolUseEmbed(toolName, input);
    const decision = await streamer.promptToolApproval(toolName, input);

    if (decision === 'allow') {
      return { behavior: 'allow' as const, updatedInput: input };
    } else {
      return { behavior: 'deny' as const, message: 'User denied this tool use.' };
    }
  };
}

// ── Core query processor (shared) ──────────────────────────────────────

/** Check if an error is a JSON/surrogate encoding issue from corrupted session history. */
function isJsonEncodingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('not valid JSON') || msg.includes('surrogate') || msg.includes('exit');
}

async function processQuery(
  q: AsyncIterable<any>,
  streamer: DiscordStreamer,
  session: ActiveSession,
  projectName: string,
  reactMessage: Message | null
): Promise<{ exitType: string; cost?: number; duration?: number; sessionId?: string } | null> {
  let resultData: { exitType: string; cost?: number; duration?: number; sessionId?: string } | null = null;

  for await (const message of q) {
    if (message.type === 'system' && (message as any).subtype === 'init') {
      const sid = (message as any).session_id ?? null;
      if (sid) {
        session.sessionId = sid;
        updateProjectSession(projectName, sid);
      }
    }

    if (message.type === 'assistant' && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if ('text' in block && block.text) {
          streamer.append(block.text);
        }
      }
    }

    // Capture rate limit events for usage tracking
    if (message.type === 'rate_limit_event') {
      const info = (message as any).rate_limit_info;
      if (info) captureRateLimitEvent(info);
    }

    if (message.type === 'result') {
      const r = message as any;
      resultData = {
        exitType: r.subtype ?? 'unknown',
        cost: r.total_cost_usd,
        duration: r.duration_ms,
        sessionId: r.session_id ?? session.sessionId ?? undefined,
      };
      if (r.session_id) {
        session.sessionId = r.session_id;
        updateProjectSession(projectName, r.session_id);
      }

      // Capture full result for usage tracking
      await captureSessionResult(projectName, r).catch(err => {
        console.error('[usage] Failed to capture session result:', err);
      });
    }
  }

  session.busy = false;
  await streamer.finish(resultData);

  if (reactMessage) {
    try {
      await reactMessage.react(resultData?.exitType === 'success' ? '✅' : '❌');
    } catch {}
  }

  return resultData;
}

// ── runClaude: creates a new thread from a main-channel message ────────

export async function runClaude(
  prompt: string,
  projectDir: string,
  projectName: string,
  originalMessage: Message,
  existingSessionId?: string
): Promise<void> {
  const channelId = originalMessage.channelId;

  const thread = await originalMessage.startThread({
    name: `⏳ ${threadLabel(prompt)}`,
    autoArchiveDuration: 60,
  });

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();
  const resumeId = existingSessionId ?? undefined;

  const session: ActiveSession = {
    abortController,
    channelId,
    threadId: thread.id,
    projectName,
    sessionId: resumeId ?? null,
    startedAt: Date.now(),
    busy: true,
  };

  activeSessions.set(thread.id, session);

  const timeout = setTimeout(() => {
    if (session.busy) abortController.abort();
  }, config.claudeTimeoutMs);

  const safePrompt = sanitize(prompt);

  try {
    const q = query({
      prompt: safePrompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        settingSources: ['user'],
        ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        env: cleanEnv,
        ...(resumeId ? { resume: resumeId } : {}),
        canUseTool: makeCanUseTool(streamer),
      },
    });

    const result = await processQuery(q, streamer, session, projectName, originalMessage);

    // If session ended with an error and we were resuming, it might be corrupted — clear the session
    if (result && result.exitType !== 'success' && result.exitType !== 'cancelled' && resumeId) {
      console.warn(`[claudeRunner] Session ended with ${result.exitType} while resuming ${resumeId}, clearing stored session`);
      updateProjectSession(projectName, '');
    }

    await setThreadName(thread, result?.exitType === 'success' ? `✅ ${threadLabel(prompt)}` : `❌ ${threadLabel(prompt)}`);
  } catch (err) {
    session.busy = false;

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      await streamer.finish({ exitType: 'cancelled' });
      await setThreadName(thread, `🛑 ${threadLabel(prompt)}`);
      try { await originalMessage.react('🛑'); } catch {}
    } else if (resumeId && isJsonEncodingError(err)) {
      // Corrupted session history — clear it and retry without resume
      console.warn(`[claudeRunner] Session ${resumeId} has encoding errors, clearing and retrying fresh`);
      session.sessionId = null;
      updateProjectSession(projectName, '');
      streamer.append('\n⚠️ Session history corrupted — starting fresh session\n');

      try {
        const freshAbort = new AbortController();
        session.abortController = freshAbort;
        session.busy = true;
        const freshQ = query({
          prompt: safePrompt,
          options: {
            cwd: projectDir,
            abortController: freshAbort,
            permissionMode: 'default',
            settingSources: ['user'],
            ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
            env: cleanEnv,
            canUseTool: makeCanUseTool(streamer),
          },
        });
        const freshResult = await processQuery(freshQ, streamer, session, projectName, originalMessage);
        await setThreadName(thread, freshResult?.exitType === 'success' ? `✅ ${threadLabel(prompt)}` : `❌ ${threadLabel(prompt)}`);
      } catch (retryErr) {
        session.busy = false;
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        streamer.append(`\n[error] Retry also failed: ${retryMsg}\n`);
        await streamer.finish({ exitType: 'error' });
        await setThreadName(thread, `❌ ${threadLabel(prompt)}`);
        try { await originalMessage.react('❌'); } catch {}
      }
    } else {
      streamer.append(`\n[error] ${msg}\n`);
      await streamer.finish({ exitType: 'error' });
      await setThreadName(thread, `❌ ${threadLabel(prompt)}`);
      try { await originalMessage.react('❌'); } catch {}
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── runClaudeInThread: run in an EXISTING thread (used by loops) ───────

export async function runClaudeInThread(
  prompt: string,
  projectDir: string,
  projectName: string,
  thread: AnyThreadChannel,
  existingSessionId?: string
): Promise<{ exitType: string; cost?: number; duration?: number; sessionId?: string } | null> {
  const threadId = thread.id;
  const channelId = thread.parentId!;

  const existing = activeSessions.get(threadId);
  if (existing?.busy) {
    await thread.send('⚠️ Claude is still working on the previous query. Waiting...');
    return null;
  }

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();
  const resumeId = existing?.sessionId ?? existingSessionId ?? undefined;

  const session: ActiveSession = {
    abortController,
    channelId,
    threadId,
    projectName,
    sessionId: resumeId ?? null,
    startedAt: Date.now(),
    busy: true,
  };

  activeSessions.set(threadId, session);

  const timeout = setTimeout(() => {
    if (session.busy) abortController.abort();
  }, config.claudeTimeoutMs);

  const safePrompt = sanitize(prompt);

  try {
    const q = query({
      prompt: safePrompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        settingSources: ['user'],
        ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        env: cleanEnv,
        ...(resumeId ? { resume: resumeId } : {}),
        canUseTool: makeCanUseTool(streamer),
      },
    });

    return await processQuery(q, streamer, session, projectName, null);
  } catch (err) {
    session.busy = false;

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      await streamer.finish({ exitType: 'cancelled' });
    } else {
      streamer.append(`\n[error] ${msg}\n`);
      await streamer.finish({ exitType: 'error' });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── continueInThread: follow-up in an existing session thread ──────────

export async function continueInThread(
  prompt: string,
  projectDir: string,
  projectName: string,
  message: Message
): Promise<void> {
  const thread = message.channel as AnyThreadChannel;
  const threadId = thread.id;
  const session = activeSessions.get(threadId);

  if (session?.busy) {
    await message.reply('Claude is still working. Wait for it to finish or use `/cancel`.');
    return;
  }

  const resumeId = session?.sessionId ?? undefined;
  if (!resumeId) {
    await message.reply('No session to continue. Start a new prompt in the main channel.');
    return;
  }

  // Update thread name while working
  const currentName = thread.name.replace(/^[⏳✅❌🛑🔁]+\s*/, '');
  await setThreadName(thread, `⏳ ${currentName}`);

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();

  if (session) {
    session.abortController = abortController;
    session.busy = true;
  }

  const activeSession = session ?? {
    abortController,
    channelId: thread.parentId!,
    threadId,
    projectName,
    sessionId: resumeId,
    startedAt: Date.now(),
    busy: true,
  };

  activeSessions.set(threadId, activeSession);

  const timeout = setTimeout(() => {
    if (activeSession.busy) abortController.abort();
  }, config.claudeTimeoutMs);

  const safePrompt = sanitize(prompt);

  try {
    const q = query({
      prompt: safePrompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        settingSources: ['user'],
        ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        env: cleanEnv,
        resume: resumeId,
        canUseTool: makeCanUseTool(streamer),
      },
    });

    const result = await processQuery(q, streamer, activeSession, projectName, message);
    await setThreadName(thread, `✅ ${currentName}`);

    if (result?.exitType !== 'success') {
      await setThreadName(thread, `❌ ${currentName}`);
    }
  } catch (err) {
    activeSession.busy = false;

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      await streamer.finish({ exitType: 'cancelled' });
      await setThreadName(thread, `🛑 ${currentName}`);
    } else {
      streamer.append(`\n[error] ${msg}\n`);
      await streamer.finish({ exitType: 'error' });
      await setThreadName(thread, `❌ ${currentName}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Session management ─────────────────────────────────────────────────

export async function cancelSession(threadId: string): Promise<boolean> {
  const session = activeSessions.get(threadId);
  if (!session) return false;

  session.abortController.abort();
  session.busy = false;
  return true;
}

export async function cancelAllForChannel(channelId: string): Promise<number> {
  let count = 0;
  for (const [, session] of activeSessions) {
    if (session.channelId === channelId && session.busy) {
      session.abortController.abort();
      session.busy = false;
      count++;
    }
  }
  return count;
}

export function clearSession(threadId: string): void {
  activeSessions.delete(threadId);
}

export function getAllSessions(): Map<string, ActiveSession> {
  return activeSessions;
}

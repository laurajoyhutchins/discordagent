import { query } from '@anthropic-ai/claude-agent-sdk';
import { Message, AnyThreadChannel } from 'discord.js';
import { config } from '../config.js';
import { DiscordStreamer } from './discordStreamer.js';
import { updateProjectSession } from './projectStore.js';
import type { ActiveSession } from '../types.js';

const activeSessions = new Map<string, ActiveSession>();

// Map thread IDs to their parent channel's session ID for resume
const threadSessionMap = new Map<string, string>();

// Tools that are auto-approved (read-only)
const AUTO_APPROVED_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'TodoRead', 'TodoWrite', 'Agent',
];

export function getSession(channelId: string): ActiveSession | undefined {
  return activeSessions.get(channelId);
}

export function hasSession(channelId: string): boolean {
  return activeSessions.has(channelId);
}

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

    if (AUTO_APPROVED_TOOLS.includes(toolName)) {
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

async function processQuery(
  q: AsyncIterable<any>,
  streamer: DiscordStreamer,
  session: ActiveSession,
  projectName: string,
  originalMessage: Message
): Promise<void> {
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
    }
  }

  session.busy = false;
  await streamer.finish(resultData);
  try {
    await originalMessage.react(resultData?.exitType === 'success' ? '✅' : '❌');
  } catch {}
}

/**
 * Start a new session from a message in #claude (creates a thread)
 */
export async function runClaude(
  prompt: string,
  projectDir: string,
  projectName: string,
  originalMessage: Message,
  existingSessionId?: string
): Promise<void> {
  const channelId = originalMessage.channelId;
  const existing = activeSessions.get(channelId);

  if (existing?.busy) {
    await originalMessage.reply('Claude is still working. Use `/cancel` to stop it, or wait for it to finish.');
    return;
  }

  const thread = await originalMessage.startThread({
    name: `Claude: ${prompt.slice(0, 90)}`,
    autoArchiveDuration: 60,
  });

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();
  const resumeId = existing?.sessionId ?? existingSessionId ?? undefined;

  const session: ActiveSession = existing ?? {
    abortController,
    channelId,
    threadId: thread.id,
    projectName,
    sessionId: resumeId ?? null,
    startedAt: Date.now(),
    busy: true,
  };

  session.abortController = abortController;
  session.threadId = thread.id;
  session.busy = true;

  activeSessions.set(channelId, session);

  try {
    const q = query({
      prompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        settingSources: ['user', 'project', 'local'],
        env: { ...process.env, CLAUDECODE: undefined },
        ...(resumeId ? { resume: resumeId } : {}),
        canUseTool: makeCanUseTool(streamer),
      },
    });

    // Track this thread -> session for follow-ups
    threadSessionMap.set(thread.id, channelId);

    await processQuery(q, streamer, session, projectName, originalMessage);

  } catch (err) {
    session.busy = false;

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      await streamer.finish({ exitType: 'cancelled' });
      try { await originalMessage.react('🛑'); } catch {}
    } else {
      streamer.append(`\n[error] ${msg}\n`);
      await streamer.finish({ exitType: 'error' });
      try { await originalMessage.react('❌'); } catch {}
    }
  }
}

/**
 * Continue a session from a follow-up message in a thread
 */
export async function continueInThread(
  prompt: string,
  projectDir: string,
  projectName: string,
  message: Message
): Promise<void> {
  const thread = message.channel as AnyThreadChannel;
  const parentChannelId = thread.parentId!;
  const session = activeSessions.get(parentChannelId);

  if (session?.busy) {
    await message.reply('Claude is still working. Wait for it to finish or use `/cancel`.');
    return;
  }

  const resumeId = session?.sessionId ?? undefined;
  if (!resumeId) {
    await message.reply('No session to continue. Start a new prompt in the main channel.');
    return;
  }

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();

  if (session) {
    session.abortController = abortController;
    session.busy = true;
  }

  const activeSession = session ?? {
    abortController,
    channelId: parentChannelId,
    threadId: thread.id,
    projectName,
    sessionId: resumeId,
    startedAt: Date.now(),
    busy: true,
  };

  activeSessions.set(parentChannelId, activeSession);

  try {
    const q = query({
      prompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        settingSources: ['user', 'project', 'local'],
        env: { ...process.env, CLAUDECODE: undefined },
        resume: resumeId,
        canUseTool: makeCanUseTool(streamer),
      },
    });

    await processQuery(q, streamer, activeSession, projectName, message);

  } catch (err) {
    activeSession.busy = false;

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      await streamer.finish({ exitType: 'cancelled' });
    } else {
      streamer.append(`\n[error] ${msg}\n`);
      await streamer.finish({ exitType: 'error' });
    }
  }
}

export async function cancelSession(channelId: string): Promise<boolean> {
  const session = activeSessions.get(channelId);
  if (!session) return false;

  session.abortController.abort();
  session.busy = false;
  return true;
}

export function clearSession(channelId: string): void {
  activeSessions.delete(channelId);
}

export function getAllSessions(): Map<string, ActiveSession> {
  return activeSessions;
}

import { query } from '@anthropic-ai/claude-agent-sdk';
import { Message } from 'discord.js';
import { config } from '../config.js';
import { DiscordStreamer } from './discordStreamer.js';
import type { ActiveSession } from '../types.js';

const activeSessions = new Map<string, ActiveSession>();

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

export async function runClaude(
  prompt: string,
  projectDir: string,
  projectName: string,
  originalMessage: Message,
  resumeSessionId?: string
): Promise<void> {
  const channelId = originalMessage.channelId;

  if (activeSessions.has(channelId)) {
    await originalMessage.reply('A Claude session is already running in this channel. Use `/cancel` to stop it first.');
    return;
  }

  // Create a thread on the user's message
  const thread = await originalMessage.startThread({
    name: `Claude: ${prompt.slice(0, 90)}`,
    autoArchiveDuration: 60,
  });

  const streamer = new DiscordStreamer(thread);
  streamer.start();

  const abortController = new AbortController();

  const timeout = setTimeout(() => {
    abortController.abort();
  }, config.claudeTimeoutMs);

  const session: ActiveSession = {
    query: null as any, // Set below
    abortController,
    channelId,
    threadId: thread.id,
    projectName,
    sessionId: resumeSessionId ?? null,
    startedAt: Date.now(),
    timeout,
  };

  activeSessions.set(channelId, session);

  try {
    const q = query({
      prompt,
      options: {
        cwd: projectDir,
        abortController,
        permissionMode: 'default',
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        canUseTool: async (toolName, input, opts) => {
          // Handle AskUserQuestion specially
          if (toolName === 'AskUserQuestion') {
            const questions = (input as any).questions ?? [];
            const answers = await streamer.promptAskUserQuestion(questions);
            return {
              behavior: 'allow' as const,
              updatedInput: { questions: (input as any).questions, answers },
            };
          }

          // Auto-approve read-only tools
          if (AUTO_APPROVED_TOOLS.includes(toolName)) {
            await streamer.sendToolUseEmbed(toolName, input);
            return { behavior: 'allow' as const, updatedInput: input };
          }

          // Show embed and ask for approval
          await streamer.sendToolUseEmbed(toolName, input);
          const decision = await streamer.promptToolApproval(toolName, input);

          if (decision === 'allow') {
            return { behavior: 'allow' as const, updatedInput: input };
          } else {
            return { behavior: 'deny' as const, message: 'User denied this tool use.' };
          }
        },
      },
    });

    session.query = q;

    let resultData: { exitType: string; cost?: number; duration?: number; sessionId?: string } | null = null;

    for await (const message of q) {
      // System init — capture session ID
      if (message.type === 'system' && (message as any).subtype === 'init') {
        session.sessionId = (message as any).session_id ?? null;
      }

      // Assistant message — extract text and tool use blocks
      if (message.type === 'assistant' && (message as any).message?.content) {
        for (const block of (message as any).message.content) {
          if ('text' in block && block.text) {
            streamer.append(block.text);
          }
          // Tool use blocks are handled via canUseTool callback
        }
      }

      // User message (tool results)
      if (message.type === 'user' && (message as any).message?.content) {
        const content = (message as any).message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && typeof block.content === 'string') {
              // Optionally show truncated tool results
              if (block.content.length > 0 && block.content.length < 2000) {
                // Small results are fine to skip — they'll be visible in Claude's response
              }
            }
          }
        }
      }

      // Result — session complete
      if (message.type === 'result') {
        const r = message as any;
        resultData = {
          exitType: r.subtype ?? 'unknown',
          cost: r.total_cost_usd,
          duration: r.duration_ms,
          sessionId: r.session_id ?? session.sessionId ?? undefined,
        };
      }
    }

    clearTimeout(timeout);
    activeSessions.delete(channelId);
    await streamer.finish(resultData);

    // React on original message
    try {
      await originalMessage.react(resultData?.exitType === 'success' ? '✅' : '❌');
    } catch {}

  } catch (err) {
    clearTimeout(timeout);
    activeSessions.delete(channelId);

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

export async function cancelSession(channelId: string): Promise<boolean> {
  const session = activeSessions.get(channelId);
  if (!session) return false;

  session.abortController.abort();
  return true;
}

export function getAllSessions(): Map<string, ActiveSession> {
  return activeSessions;
}

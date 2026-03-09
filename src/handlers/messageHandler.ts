import { Message, ChannelType } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { runClaude, continueInThread } from '../services/claudeRunner.js';
import { parseLoopCommand, startLoop, stopLoop } from '../services/loopRunner.js';
import { isAuthorized } from '../utils/permissions.js';

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const prompt = message.content.trim();
  if (!prompt) return;

  // Check if this is a message in a thread (follow-up)
  if (message.channel.isThread()) {
    const parentId = message.channel.parentId;
    if (!parentId) return;

    const project = getProjectByChannel(parentId);
    if (!project || parentId !== project.claudeChannelId) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!isAuthorized(member)) return;

    await continueInThread(prompt, project.workingDirectory, project.name, message);
    return;
  }

  // Main channel message — check if it's a project channel
  const project = getProjectByChannel(message.channelId);
  if (!project) return;
  if (message.channelId !== project.claudeChannelId) return;

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!isAuthorized(member)) {
    await message.reply('You are not authorized to use this bot.');
    return;
  }

  // Handle bot commands before sending to Claude
  if (prompt.startsWith('/')) {
    const handled = await handleBotCommand(prompt, project, message);
    if (handled) return;
  }

  await runClaude(prompt, project.workingDirectory, project.name, message, project.sessionId);
}

/**
 * Handle bot-level commands (prefixed with /).
 * Returns true if the command was handled, false if it should be passed to Claude.
 */
async function handleBotCommand(
  content: string,
  project: import('../types.js').Project,
  message: Message
): Promise<boolean> {
  const lower = content.toLowerCase();

  // /loop [interval] <prompt>
  if (lower.startsWith('/loop')) {
    const parsed = parseLoopCommand(content);
    if (!parsed) {
      await message.reply(
        '**Usage:** `/loop [interval] <prompt>`\n' +
        'Examples:\n' +
        '- `/loop 5m check for failing tests`\n' +
        '- `/loop 1h summarize git log`\n' +
        '- `/loop review open PRs` (defaults to 10m)'
      );
      return true;
    }

    await startLoop(parsed.intervalMs, parsed.prompt, project, message);
    return true;
  }

  // /stop-loop
  if (lower.startsWith('/stop-loop') || lower.startsWith('/stoploops') || lower.startsWith('/stop loop')) {
    await stopLoop(project.claudeChannelId, message);
    return true;
  }

  // Unknown / command — pass through to Claude
  return false;
}

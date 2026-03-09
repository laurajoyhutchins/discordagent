import { Message, ChannelType } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { runClaude, continueInThread } from '../services/claudeRunner.js';
import { parseLoopCommand, startLoop, stopLoop, getLoopStatus, getLoopChannelForThread } from '../services/loopRunner.js';
import { isAuthorized } from '../utils/permissions.js';

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const prompt = message.content.trim();
  if (!prompt) return;

  // Check if this is a message in a thread (follow-up or loop thread)
  if (message.channel.isThread()) {
    const parentId = message.channel.parentId;
    if (!parentId) return;

    const project = getProjectByChannel(parentId);
    if (!project || parentId !== project.claudeChannelId) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!isAuthorized(member)) return;

    // Handle /stop-loop inside a loop thread
    const lower = prompt.toLowerCase();
    if (lower.startsWith('/stop-loop') || lower.startsWith('/stoploop') || lower.startsWith('/stop loop')) {
      const loopChannelId = getLoopChannelForThread(message.channel.id);
      if (loopChannelId) {
        await stopLoop(loopChannelId, message);
        return;
      }
      await message.reply('No loop is associated with this thread.');
      return;
    }

    // Handle /status inside a loop thread
    if (lower === '/status') {
      const loopChannelId = getLoopChannelForThread(message.channel.id);
      if (loopChannelId) {
        const status = getLoopStatus(loopChannelId);
        if (status) {
          await message.reply(status);
          return;
        }
      }
    }

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

  // Start a new Claude session in a new thread (concurrent sessions allowed)
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
  if (lower.startsWith('/stop-loop') || lower.startsWith('/stoploop') || lower.startsWith('/stop loop')) {
    await stopLoop(project.claudeChannelId, message);
    return true;
  }

  // /status — show loop status
  if (lower === '/status') {
    const status = getLoopStatus(project.claudeChannelId);
    if (status) {
      await message.reply(status);
    } else {
      await message.reply('No loop running. Send a message to start a Claude session, or use `/loop` to start a recurring task.');
    }
    return true;
  }

  // Unknown / command — pass through to Claude
  return false;
}

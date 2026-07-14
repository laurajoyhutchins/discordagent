import { Message, ChannelType } from 'discord.js';
import { getProjectByChannel, updateProjectModel } from '../services/projectStore.js';
import { runClaude, continueInThread } from '../services/claudeRunner.js';
import { parseLoopCommand, startLoop, stopLoop, getLoopStatus, getLoopChannelForThread } from '../services/loopRunner.js';
import { isAuthorized } from '../utils/permissions.js';
import { config } from '../config.js';

/**
 * Parse a `/model <model-name>` prefix from a message.
 * Returns { model, rest } if found, or { model: undefined, rest: original } if not.
 * Example: "/model fable-5 fix the bug" → { model: "fable-5", rest: "fix the bug" }
 */
function parseModelPrefix(text: string): { model: string | undefined; rest: string } {
  const match = text.match(/^\/model\s+(\S+)\s+([\s\S]+)$/i);
  if (match) {
    return { model: match[1], rest: match[2].trim() };
  }
  return { model: undefined, rest: text };
}

/** Log message receipt with gateway lag — helps diagnose delayed pickups. */
function logPickup(message: Message, prompt: string, lagMs: number): void {
  const flag = lagMs > 2000 ? ' ⚠️ SLOW PICKUP' : '';
  console.log(`[msg] "${prompt.slice(0, 50)}" from ${message.author.tag} | gateway lag ${lagMs}ms${flag}`);
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const prompt = message.content.trim();
  if (!prompt) return;

  // Pickup lag (Discord send → our receipt) for diagnosing delivery delays.
  // Logged only for project channels below to keep logs quiet.
  const lagMs = Date.now() - message.createdTimestamp;

  // Check if this is a message in a thread (follow-up or loop thread)
  if (message.channel.isThread()) {
    const parentId = message.channel.parentId;
    if (!parentId) return;

    const project = getProjectByChannel(parentId);
    if (!project || parentId !== project.agentChannelId) return;

    logPickup(message, prompt, lagMs);

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

    // Bare /model with no prompt — nothing to run, show usage instead
    if (/^\/model(\s+\S+)?$/i.test(prompt)) {
      await message.reply(
        'Usage in threads: `/model <name> <prompt>` for a one-shot model override.\n' +
        'To change the project default, use `/model <name>` (or the `/model` slash command) in the main channel.'
      );
      return;
    }

    const threadParsed = parseModelPrefix(prompt);
    await continueInThread(threadParsed.rest, project.workingDirectory, project.name, message, threadParsed.model);
    return;
  }

  // Main channel message — check if it's a project channel
  const project = getProjectByChannel(message.channelId);
  if (!project) return;
  if (message.channelId !== project.agentChannelId) return;

  logPickup(message, prompt, lagMs);

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!isAuthorized(member)) {
    await message.reply('You are not authorized to use this bot.');
    return;
  }

  // Parse /model prefix before checking for bot commands
  const { model, rest: actualPrompt } = parseModelPrefix(prompt);

  // Handle bot commands before sending to Claude
  // Use original prompt for command detection (don't strip /model for other / commands)
  if (!model && prompt.startsWith('/')) {
    const handled = await handleBotCommand(prompt, project, message);
    if (handled) return;
  }

  // Start a fresh Claude session in a new thread — no session resume.
  // Only thread follow-ups (continueInThread) resume existing sessions.
  await runClaude(actualPrompt, project.workingDirectory, project.name, message, undefined, model);
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

  // /model [name] — show or persistently set this project's default model.
  // (`/model <name> <prompt>` is handled earlier as a one-shot override.)
  if (lower === '/model' || /^\/model\s+\S+$/i.test(content)) {
    const arg = content.split(/\s+/)[1];
    if (!arg) {
      const current = project.models?.claude || config.defaultModel || 'SDK default';
      await message.reply(
        `Current model for **${project.name}**: \`${current}\`\n` +
        'Set it with `/model <name>` (e.g. `sonnet`, `opus`, `haiku`), or prefix a prompt with `/model <name>` for a one-shot override.'
      );
      return true;
    }
    updateProjectModel(project.name, arg);
    await message.reply(`Model for **${project.name}** set to \`${arg}\`.`);
    return true;
  }

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
    await stopLoop(project.agentChannelId, message);
    return true;
  }

  // /status — show loop status
  if (lower === '/status') {
    const status = getLoopStatus(project.agentChannelId);
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

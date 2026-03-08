import { Message, ChannelType } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { runClaude, continueInThread } from '../services/claudeRunner.js';
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

  // Main channel message — start new session thread
  const project = getProjectByChannel(message.channelId);
  if (!project) return;
  if (message.channelId !== project.claudeChannelId) return;

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!isAuthorized(member)) {
    await message.reply('You are not authorized to use this bot.');
    return;
  }

  await runClaude(prompt, project.workingDirectory, project.name, message, project.sessionId);
}

import { Message } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { runClaude } from '../services/claudeRunner.js';
import { isAuthorized } from '../utils/permissions.js';

export async function handleMessage(message: Message): Promise<void> {
  // Ignore bots and DMs
  if (message.author.bot) return;
  if (!message.guild) return;

  // Only respond in managed #claude channels
  const project = getProjectByChannel(message.channelId);
  if (!project) return;
  if (message.channelId !== project.claudeChannelId) return;

  // Auth check
  const member = message.guild.members.cache.get(message.author.id) ?? null;
  if (!isAuthorized(member)) {
    await message.reply('You are not authorized to use this bot.');
    return;
  }

  const prompt = message.content.trim();
  if (!prompt) return;

  await runClaude(prompt, project.workingDirectory, project.name, message);
}

import { ChatInputCommandInteraction } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { stopLoop, getLoopChannelForThread } from '../services/loopRunner.js';
import { isAuthorized } from '../utils/permissions.js';

export async function handleStopLoop(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = await interaction.guild?.members.fetch(interaction.user.id)
    .catch((e) => { console.warn('[stop-loop] member fetch failed:', e); return null; }) ?? null;
  if (!isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized.', ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  let targetChannelId: string | undefined;

  // If used inside a loop thread, resolve to the parent channel's loop
  if (channel?.isThread()) {
    targetChannelId = getLoopChannelForThread(channel.id);
    if (!targetChannelId) {
      // Maybe it's a regular thread in a project channel — check parent
      const parentId = channel.parentId;
      if (parentId) {
        const project = getProjectByChannel(parentId);
        if (project) {
          targetChannelId = project.claudeChannelId;
        }
      }
    }
  } else {
    // Main channel
    const project = getProjectByChannel(interaction.channelId);
    if (project) {
      targetChannelId = project.claudeChannelId;
    }
  }

  if (!targetChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project channel or loop thread.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const replyMsg = await interaction.fetchReply();
  await stopLoop(targetChannelId, replyMsg);
}

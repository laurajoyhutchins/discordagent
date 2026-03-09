import { ChatInputCommandInteraction } from 'discord.js';
import { cancelSession, cancelAllForChannel, getSession } from '../services/claudeRunner.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { cancelLoop, getLoopChannelForThread } from '../services/loopRunner.js';

export async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  const channelId = interaction.channelId;

  // If used in a thread, cancel that specific thread's session
  if (channel?.isThread()) {
    const parts: string[] = [];

    // Cancel the session in this thread
    const session = getSession(channelId);
    if (session) {
      const cancelled = await cancelSession(channelId);
      if (cancelled) parts.push('Claude session cancelled in this thread.');
    }

    // If this is a loop thread, also stop the loop
    const loopChannelId = getLoopChannelForThread(channelId);
    if (loopChannelId) {
      const loopIters = cancelLoop(loopChannelId);
      if (loopIters !== null) {
        parts.push(`Stopped loop (${loopIters} iteration${loopIters !== 1 ? 's' : ''} completed).`);
      }
    }

    if (parts.length === 0) {
      await interaction.reply({ content: 'No active session or loop in this thread.', ephemeral: true });
    } else {
      await interaction.reply(parts.join('\n'));
    }
    return;
  }

  // In main channel — cancel all sessions + any running loop
  const project = getProjectByChannel(channelId);
  if (!project) {
    await interaction.reply({ content: 'This command can only be used in a project channel or thread.', ephemeral: true });
    return;
  }

  const projectChannelId = project.claudeChannelId;
  const sessionCount = await cancelAllForChannel(projectChannelId);
  const loopIterations = cancelLoop(projectChannelId);

  const parts: string[] = [];
  if (sessionCount > 0) {
    parts.push(`Cancelled ${sessionCount} active session${sessionCount > 1 ? 's' : ''}.`);
  }
  if (loopIterations !== null) {
    parts.push(`Stopped loop (${loopIterations} iteration${loopIterations !== 1 ? 's' : ''} completed).`);
  }

  if (parts.length === 0) {
    await interaction.reply({ content: 'No active sessions or loops to cancel.', ephemeral: true });
  } else {
    await interaction.reply(parts.join('\n'));
  }
}

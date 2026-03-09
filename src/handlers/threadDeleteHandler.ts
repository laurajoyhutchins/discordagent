import { AnyThreadChannel } from 'discord.js';
import { cancelSession, clearSession } from '../services/claudeRunner.js';

export async function handleThreadDelete(thread: AnyThreadChannel): Promise<void> {
  // Cancel any running session in this thread and clear it from memory
  await cancelSession(thread.id);
  clearSession(thread.id);

  console.log(`[thread] Deleted thread ${thread.id}, cleaned up session`);
}

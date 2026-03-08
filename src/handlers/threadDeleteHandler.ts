import { AnyThreadChannel } from 'discord.js';
import { cancelSession, clearSession } from '../services/claudeRunner.js';

export async function handleThreadDelete(thread: AnyThreadChannel): Promise<void> {
  const parentId = thread.parentId;
  if (!parentId) return;

  // Cancel any running session and clear it from memory
  await cancelSession(parentId);
  clearSession(parentId);

  console.log(`[thread] Deleted thread ${thread.id}, cleaned up session for channel ${parentId}`);
}

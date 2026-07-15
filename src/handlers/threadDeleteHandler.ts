import type { AnyThreadChannel } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';

export async function handleThreadDelete(
  thread: AnyThreadChannel,
  coordinator: Pick<TaskCoordinator, 'cancelByThread'> = getTaskCoordinator(),
): Promise<void> {
  const cancelled = await coordinator.cancelByThread(thread.id);
  console.log(
    cancelled
      ? `[thread] Deleted thread ${thread.id}; durable task cancelled and worktree preserved`
      : `[thread] Deleted thread ${thread.id}; no active durable task found`,
  );
}

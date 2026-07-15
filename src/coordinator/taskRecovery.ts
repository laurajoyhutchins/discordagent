import type { EventRepository } from '../repositories/eventRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { WorktreeManager } from '../git/worktreeManager.js';
import type { TaskRecord } from '../types.js';

export interface TaskRecoveryDependencies {
  tasks: TaskRepository;
  events: EventRepository;
  worktrees: WorktreeManager;
}

export async function recoverInterruptedTasks(
  dependencies: TaskRecoveryDependencies,
): Promise<TaskRecord[]> {
  const recovered: TaskRecord[] = [];

  for (const task of dependencies.tasks.listRecoverable()) {
    const worktree = dependencies.tasks.getWorktree(task.id);
    let detail = 'No worktree record was found. Resume requires explicit user action.';

    if (worktree) {
      try {
        const inspection = await dependencies.worktrees.inspect(worktree.worktreePath);
        detail = inspection.exists
          ? `Worktree preserved at ${worktree.worktreePath} (${inspection.dirty ? 'uncommitted changes present' : 'clean'}). Resume requires explicit user action; no provider turn was replayed.`
          : `Worktree path ${worktree.worktreePath} is missing. Resume requires explicit user action; no provider turn was replayed.`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        detail = `Worktree inspection failed: ${message}. Resume requires explicit user action; no provider turn was replayed.`;
      }
    }

    const interrupted = dependencies.tasks.transition(task.id, [task.status], 'interrupted');
    dependencies.events.append(task.id, {
      type: 'status',
      phase: 'Recovery checkpoint',
      detail,
    }, `recovery:${task.updatedAt}`);
    recovered.push(interrupted);
  }

  return recovered;
}

import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';

let coordinator: TaskCoordinator | null = null;

export function setTaskCoordinator(value: TaskCoordinator): void {
  coordinator = value;
}

export function getTaskCoordinator(): TaskCoordinator {
  if (!coordinator) {
    throw new Error('Task coordinator is not initialized');
  }
  return coordinator;
}

export function clearTaskCoordinator(): void {
  coordinator = null;
}

import type { Message } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';

export interface PendingTaskRequest {
  userId: string;
  projectName: string;
  prompt: string;
  message: Message;
  model?: string;
  createdAt: number;
  expiresAt: number;
}

export interface PendingTaskService {
  defer(input: Omit<PendingTaskRequest, 'createdAt' | 'expiresAt'>): PendingTaskRequest;
  get(userId: string): PendingTaskRequest | undefined;
  discard(userId: string): boolean;
  start(userId: string): Promise<void>;
  clear(): void;
}

export function createPendingTaskService(
  coordinator: Pick<TaskCoordinator, 'startFromMessage'>,
  options: { ttlMs?: number; now?: () => number } = {},
): PendingTaskService {
  const ttlMs = options.ttlMs ?? 30 * 60_000;
  const now = options.now ?? Date.now;
  const pending = new Map<string, PendingTaskRequest>();
  const getPending = (userId: string): PendingTaskRequest | undefined => {
    const request = pending.get(userId);
    if (request && request.expiresAt <= now()) { pending.delete(userId); return undefined; }
    return request;
  };
  return {
    defer(input) {
      const createdAt = now();
      const request = { ...input, createdAt, expiresAt: createdAt + ttlMs };
      pending.set(input.userId, request);
      return request;
    },
    get: getPending,
    discard(userId) {
      return pending.delete(userId);
    },
    async start(userId) {
      const request = getPending(userId);
      if (!request) throw new Error('No pending Codex task is available');
      await coordinator.startFromMessage({
        projectName: request.projectName,
        prompt: request.prompt,
        message: request.message,
        provider: 'codex',
        ...(request.model ? { model: request.model } : {}),
      });
      pending.delete(userId);
    },
    clear() {
      pending.clear();
    },
  };
}

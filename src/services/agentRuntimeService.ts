import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { PendingTaskService } from './pendingTaskService.js';

let providers: ProviderRegistry | null = null;
let codexAuth: CodexAuthService | null = null;
let tasks: TaskRepository | null = null;
let pendingTasks: PendingTaskService | null = null;

export function setAgentRuntimeServices(input: { providers: ProviderRegistry; codexAuth?: CodexAuthService; tasks?: TaskRepository; pendingTasks?: PendingTaskService }): void {
  providers = input.providers;
  codexAuth = input.codexAuth ?? null;
  tasks = input.tasks ?? null;
  pendingTasks = input.pendingTasks ?? null;
}
export function clearAgentRuntimeServices(): void { providers = null; codexAuth = null; tasks = null; pendingTasks?.clear(); pendingTasks = null; }
export function getProviderRegistry(): ProviderRegistry {
  if (!providers) throw new Error('Agent runtime is not initialized');
  return providers;
}
export function getCodexAuthService(): CodexAuthService {
  if (!codexAuth) throw new Error('Codex App Server is not available on this host');
  return codexAuth;
}
export function maybeGetCodexAuthService(): CodexAuthService | undefined { return codexAuth ?? undefined; }

export function getTaskRepository(): TaskRepository { if (!tasks) throw new Error('Task repository is not initialized'); return tasks; }

export function maybeGetPendingTaskService(): PendingTaskService | undefined { return pendingTasks ?? undefined; }

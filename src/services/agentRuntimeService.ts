import type { AgentProviderId } from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { PendingTaskService } from './pendingTaskService.js';
import type { ProviderOnboardingService } from './providerOnboarding.js';

let providers: ProviderRegistry | null = null;
let codexAuth: CodexAuthService | null = null;
let tasks: TaskRepository | null = null;
let pendingTasks: PendingTaskService | null = null;
let providerOnboarding: ProviderOnboardingService | null = null;
let primaryProviderActivator: ((provider: AgentProviderId) => Promise<void>) | null = null;

export function setAgentRuntimeServices(input: { providers: ProviderRegistry; codexAuth?: CodexAuthService; tasks?: TaskRepository; pendingTasks?: PendingTaskService; providerOnboarding?: ProviderOnboardingService; primaryProviderActivator?: (provider: AgentProviderId) => Promise<void> }): void {
  providers = input.providers;
  codexAuth = input.codexAuth ?? null;
  tasks = input.tasks ?? null;
  pendingTasks = input.pendingTasks ?? null;
  providerOnboarding = input.providerOnboarding ?? null;
  primaryProviderActivator = input.primaryProviderActivator ?? null;
}
export function clearAgentRuntimeServices(): void { providers = null; codexAuth = null; tasks = null; pendingTasks?.clear(); pendingTasks = null; providerOnboarding = null; primaryProviderActivator = null; }
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
export function maybeGetProviderOnboardingService(): ProviderOnboardingService | undefined { return providerOnboarding ?? undefined; }
export async function activatePrimaryProvider(provider: AgentProviderId): Promise<void> {
  if (!primaryProviderActivator) throw new Error('The PM chat is not ready to change providers. Restart the bot and try again.');
  await primaryProviderActivator(provider);
}

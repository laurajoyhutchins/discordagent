import type { AgentProviderId } from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { PendingTaskService } from './pendingTaskService.js';
import type { ProviderOnboardingService } from './providerOnboarding.js';
import type { SettingsService } from './settingsService.js';
import { clearPrimaryAgentService, getPrimaryAgentService, setPrimaryAgentService } from './primaryAgentServiceRegistry.js';

export type PrimaryProviderActivationResult = 'activated' | 'reconfigured';

let providers: ProviderRegistry | null = null;
let codexAuth: CodexAuthService | null = null;
let tasks: TaskRepository | null = null;
let pendingTasks: PendingTaskService | null = null;
let providerOnboarding: ProviderOnboardingService | null = null;
let primaryProviderActivator: ((provider: AgentProviderId) => Promise<PrimaryProviderActivationResult>) | null = null;
let settingsService: SettingsService | null = null;
let primaryChannelId: string | null = null;
let primaryOwnerId: string | null = null;

export function setAgentRuntimeServices(input: { providers: ProviderRegistry; codexAuth?: CodexAuthService; tasks?: TaskRepository; pendingTasks?: PendingTaskService; settingsService?: SettingsService; providerOnboarding?: ProviderOnboardingService; primaryProviderActivator?: (provider: AgentProviderId) => Promise<PrimaryProviderActivationResult>; primaryChannelId?: string; primaryOwnerId?: string }): void {
  providers = input.providers;
  codexAuth = input.codexAuth ?? null;
  tasks = input.tasks ?? null;
  pendingTasks = input.pendingTasks ?? null;
  settingsService = input.settingsService ?? null;
  providerOnboarding = input.providerOnboarding ?? null;
  primaryProviderActivator = input.primaryProviderActivator ?? null;
  primaryChannelId = input.primaryChannelId ?? primaryChannelId;
  primaryOwnerId = input.primaryOwnerId ?? primaryOwnerId;
}
export function clearAgentRuntimeServices(): void { providers = null; codexAuth = null; tasks = null; pendingTasks?.clear(); pendingTasks = null; settingsService = null; providerOnboarding = null; primaryProviderActivator = null; primaryChannelId = null; primaryOwnerId = null; }
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

export function getSettingsService(): SettingsService { if (!settingsService) throw new Error('Settings service is not initialized'); return settingsService; }
export function maybeGetSettingsService(): SettingsService | undefined { return settingsService ?? undefined; }

export function maybeGetPendingTaskService(): PendingTaskService | undefined { return pendingTasks ?? undefined; }
export function maybeGetProviderOnboardingService(): ProviderOnboardingService | undefined { return providerOnboarding ?? undefined; }
export function getPrimaryChannelId(): string { if (!primaryChannelId) throw new Error('Primary agent channel is not initialized'); return primaryChannelId; }
export function getPrimaryOwnerId(): string { if (!primaryOwnerId) throw new Error('Primary agent owner is not initialized'); return primaryOwnerId; }
export async function activatePrimaryProvider(provider: AgentProviderId): Promise<PrimaryProviderActivationResult> {
  if (!primaryProviderActivator) throw new Error('The PM chat is not ready to change providers. Restart the bot and try again.');
  return primaryProviderActivator(provider);
}
export function capturePrimaryProviderState(): () => void {
  const previous = getPrimaryAgentService();
  return () => { if (previous) setPrimaryAgentService(previous); else clearPrimaryAgentService(); };
}

import type { AgentProviderId, AgentTaskSettings } from '../agents/contracts.js';

const NON_CAPABILITY_PROFILES = new Set(['default', 'disabled']);

export function boundedCapabilityProfiles(availableProfiles: readonly string[]): string[] {
  return availableProfiles.filter(profile => profile.trim().length > 0 && !NON_CAPABILITY_PROFILES.has(profile));
}

export function applyBoundedCapabilityProfile(input: {
  provider: AgentProviderId;
  requestedProfile: string;
  availableProfiles: readonly string[];
  settings: AgentTaskSettings;
}): AgentTaskSettings {
  const requestedProfile = input.requestedProfile.trim();
  if (input.provider !== 'claude') {
    throw new Error(`Provider ${input.provider} does not support bounded MCP capability profiles.`);
  }
  if (!requestedProfile || NON_CAPABILITY_PROFILES.has(requestedProfile)) {
    throw new Error(`Profile "${requestedProfile || '(empty)'}" is not a bounded capability profile.`);
  }
  if (!input.availableProfiles.includes(requestedProfile)) {
    throw new Error(`Bounded capability profile "${requestedProfile}" is not available on this host.`);
  }
  return { ...input.settings, mcpProfile: requestedProfile };
}

import type { AgentProviderId, AgentTaskSettings } from '../agents/contracts.js';

export const FAST_FORWARD_CAPABILITY_PROFILE = 'fast-forward';

const PORTFOLIO_CAPABILITY_PROFILES = new Set(['github', 'linear', 'drive']);
const AUTHORIZED_CAPABILITY_PROFILES = new Set([
  ...PORTFOLIO_CAPABILITY_PROFILES,
  FAST_FORWARD_CAPABILITY_PROFILE,
]);

export function boundedCapabilityProfiles(availableProfiles: readonly string[]): string[] {
  return availableProfiles.filter(profile => PORTFOLIO_CAPABILITY_PROFILES.has(profile));
}

export function fastForwardCapabilityProfiles(availableProfiles: readonly string[]): string[] {
  return availableProfiles.includes(FAST_FORWARD_CAPABILITY_PROFILE)
    ? [FAST_FORWARD_CAPABILITY_PROFILE]
    : [];
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
  if (!AUTHORIZED_CAPABILITY_PROFILES.has(requestedProfile)) {
    throw new Error(`Profile "${requestedProfile || '(empty)'}" is not a bounded portfolio capability profile.`);
  }
  if (!input.availableProfiles.includes(requestedProfile)) {
    throw new Error(`Bounded capability profile "${requestedProfile}" is not available on this host.`);
  }
  return { ...input.settings, mcpProfile: requestedProfile };
}

export function buildFastForwardWorkSessionPrompt(input: {
  objective: string;
  sessionToken: string;
}): string {
  const objective = input.objective.trim();
  const sessionToken = input.sessionToken.trim();
  if (!objective) throw new Error('Fast Forward work-session objective is required.');
  if (!sessionToken) throw new Error('Fast Forward work-session token is required.');

  return [
    `Fast Forward work session token: ${sessionToken}`,
    `Objective: ${objective}`,
    'Before any external mutation, retrieve and obey the current live Google Drive FAST-FORWARD.SKILL.md and EXECUTION-OWNERSHIP.SKILL.md.',
    'Retrieve and obey the gate-specific live skill selected by Fast Forward before executing that gate.',
    'Treat this bootstrap as a pointer to live authority, not as a copied Fast Forward procedure.',
  ].join('\n');
}

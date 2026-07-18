import { PermissionsBitField } from 'discord.js';
import type { CapabilityEvaluation, CapabilityReport, GatewayIntentName } from './contracts.js';
import { getCapability } from './registry.js';

export interface CapabilityEvaluationMember {
  readonly permissions: PermissionsBitField;
}

export interface CapabilityPermissionChannel {
  readonly id: string;
  readonly parent?: CapabilityPermissionChannel | null;
  permissionsFor(member: unknown): PermissionsBitField | null;
}

export interface CapabilityEvaluationContext {
  readonly member?: CapabilityEvaluationMember | null;
  readonly channel?: CapabilityPermissionChannel | null;
  readonly configuredIntents?: readonly GatewayIntentName[];
}

function requiredFor(requirement: string): boolean {
  return requirement === 'core_runtime'
    || requirement === 'operation_specific'
    || requirement === 'bootstrap_only';
}

function permissionState(
  capability: ReturnType<typeof getCapability>,
  context: CapabilityEvaluationContext,
): Pick<CapabilityEvaluation, 'state' | 'reason'> {
  if (capability.intents?.some(intent => !context.configuredIntents?.includes(intent))) {
    if (!context.configuredIntents) {
      return { state: 'cannot_determine', reason: 'Gateway intent configuration was not provided.' };
    }
    return { state: 'unavailable', reason: `Required Gateway intent is not configured: ${capability.intents.join(', ')}.` };
  }

  if (capability.applicationFeature && !capability.permission) {
    return { state: 'not_applicable', reason: 'This capability is an application feature, not a bot permission bit.' };
  }
  if (!context.member) return { state: 'cannot_determine', reason: 'The bot guild member could not be determined.' };

  if (!capability.permission) return { state: 'available', reason: 'No Discord permission bit is required.' };
  if (capability.scope === 'guild') {
    return context.member.permissions.has(capability.permission)
      ? { state: 'available', reason: 'The bot has the required guild permission.' }
      : { state: 'unavailable', reason: `The bot lacks guild permission ${capability.permission}.` };
  }

  if (!context.channel) return { state: 'cannot_determine', reason: 'The target channel was not provided.' };
  const permissions = context.channel.permissionsFor(context.member)
    ?? context.channel.parent?.permissionsFor(context.member)
    ?? null;
  if (!permissions) return { state: 'cannot_determine', reason: 'Discord did not provide effective permissions for this channel.' };
  return permissions.has(capability.permission)
    ? { state: 'available', reason: 'The bot has the effective channel permission.' }
    : { state: 'unavailable', reason: `A channel overwrite prevents effective permission ${capability.permission}.` };
}

export function evaluateCapabilities(
  capabilityIds: readonly string[],
  context: CapabilityEvaluationContext,
): CapabilityReport {
  return {
    ...(context.channel?.id ? { channelId: context.channel.id } : {}),
    evaluations: capabilityIds.map(capabilityId => {
      const capability = getCapability(capabilityId);
      const state = permissionState(capability, context);
      return {
        capabilityId,
        state: state.state,
        required: requiredFor(capability.requirement),
        ...(capability.permission ? { permission: capability.permission } : {}),
        reason: state.reason,
        fallback: capability.fallback,
        remediation: capability.remediation,
      } satisfies CapabilityEvaluation;
    }),
  };
}

export function evaluateCapability(
  capabilityId: string,
  context: CapabilityEvaluationContext,
): CapabilityEvaluation {
  return evaluateCapabilities([capabilityId], context).evaluations[0];
}

export function assertCapabilities(
  report: CapabilityReport,
  message = 'The Discord operation cannot start with the current permissions.',
): void {
  const missing = report.evaluations.filter(item => item.required && item.state !== 'available');
  if (missing.length === 0) return;
  throw new Error([
    message,
    ...missing.map(item => `${item.capabilityId}: ${item.reason} ${item.remediation}`),
  ].join(' '));
}

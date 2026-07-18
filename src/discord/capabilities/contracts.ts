import type { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';

export type PermissionName = keyof typeof PermissionFlagsBits;
export type GatewayIntentName = keyof typeof GatewayIntentBits;

export type CapabilityRequirementLevel =
  | 'core_runtime'
  | 'operation_specific'
  | 'bootstrap_only'
  | 'optional'
  | 'future_application_feature';

export type CapabilityScope = 'guild' | 'channel';
export type CapabilityCategory =
  | 'core'
  | 'task'
  | 'decision'
  | 'workspace'
  | 'event'
  | 'audit'
  | 'voice'
  | 'activity';

export interface DiscordCapabilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly category: CapabilityCategory;
  readonly requirement: CapabilityRequirementLevel;
  readonly permission?: PermissionName;
  readonly intents?: readonly GatewayIntentName[];
  readonly scope: CapabilityScope;
  readonly fallback: string;
  readonly remediation: string;
  readonly applicationFeature?: string;
}

export type DiscordCapabilityProfileName = 'runtime' | 'bootstrap' | 'optional';

export interface CalculatedDiscordProfile {
  readonly name: DiscordCapabilityProfileName;
  readonly capabilityIds: readonly string[];
  readonly permissionNames: readonly PermissionName[];
  readonly permissionBits: bigint;
  readonly gatewayIntents: readonly GatewayIntentName[];
  readonly applicationFeatures: readonly string[];
}

export type CapabilityState =
  | 'available'
  | 'unavailable'
  | 'not_applicable'
  | 'cannot_determine';

export interface CapabilityEvaluation {
  readonly capabilityId: string;
  readonly state: CapabilityState;
  readonly required: boolean;
  readonly permission?: PermissionName;
  readonly reason: string;
  readonly fallback: string;
  readonly remediation: string;
}

export interface CapabilityReport {
  readonly channelId?: string;
  readonly evaluations: readonly CapabilityEvaluation[];
}

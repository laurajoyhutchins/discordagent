import { CAPABILITIES } from './registry.js';
import type { CalculatedDiscordProfile, DiscordCapabilityProfileName } from './contracts.js';
import { gatewayIntentBitsFor, permissionBitsFor } from './registry.js';

export const DISCORD_CAPABILITY_PROFILES: Readonly<Record<DiscordCapabilityProfileName, readonly string[]>> = {
  runtime: [
    'core.guild.access',
    'core.channel.view',
    'core.message.send',
    'core.message.history',
    'task.thread.create.public',
    'task.thread.send',
  ],
  bootstrap: [
    'core.guild.access',
    'core.channel.view',
    'core.message.send',
    'core.message.history',
    'task.thread.create.public',
    'task.thread.send',
    'workspace.channel.manage',
  ],
  optional: [
    'task.control-card.pin',
    'decision.poll.send',
    'audit.read',
    'workspace.webhook.manage',
    'event.create',
    'voice.message.send',
    'voice.connect',
    'voice.speak',
    'voice.status.set',
    'activity.launch',
  ],
};

export function calculateProfile(name: DiscordCapabilityProfileName): CalculatedDiscordProfile {
  const capabilityIds = DISCORD_CAPABILITY_PROFILES[name];
  const definitions = capabilityIds.map(id => {
    const definition = CAPABILITIES.find(capability => capability.id === id);
    if (!definition) throw new Error(`Profile ${name} references unknown capability ${id}`);
    return definition;
  });
  const permissionNames = definitions.flatMap(definition => definition.permission ? [definition.permission] : []);
  const gatewayIntents = [...new Set(definitions.flatMap(definition => definition.intents ?? []))];
  const applicationFeatures = [...new Set(definitions.flatMap(definition => definition.applicationFeature ? [definition.applicationFeature] : []))];
  return {
    name,
    capabilityIds: [...capabilityIds],
    permissionNames: [...new Set(permissionNames)],
    permissionBits: permissionBitsFor(permissionNames),
    gatewayIntents,
    applicationFeatures,
  };
}

export function calculateCombinedSetupProfile(): CalculatedDiscordProfile {
  const runtime = calculateProfile('runtime');
  const bootstrap = calculateProfile('bootstrap');
  const capabilityIds = [...new Set([...runtime.capabilityIds, ...bootstrap.capabilityIds])];
  return {
    name: 'bootstrap',
    capabilityIds,
    permissionNames: [...new Set([...runtime.permissionNames, ...bootstrap.permissionNames])],
    permissionBits: runtime.permissionBits | bootstrap.permissionBits,
    gatewayIntents: [...new Set([...runtime.gatewayIntents, ...bootstrap.gatewayIntents])],
    applicationFeatures: [...new Set([...runtime.applicationFeatures, ...bootstrap.applicationFeatures])],
  };
}

export function calculateGatewayIntentBits(name: DiscordCapabilityProfileName): number {
  return gatewayIntentBitsFor(calculateProfile(name).gatewayIntents);
}

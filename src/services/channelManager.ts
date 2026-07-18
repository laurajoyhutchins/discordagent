import {
  ChannelType,
  Guild,
  OverwriteResolvable,
} from 'discord.js';
import { calculateProfile } from '../discord/capabilities/profiles.js';
import { getCapability, permissionBitForCapability } from '../discord/capabilities/registry.js';

interface ChannelSetup {
  categoryId: string;
  agentChannelId: string;
  roborevChannelId?: string;
}

export async function createProjectChannels(
  guild: Guild,
  projectName: string,
  includeRoborev: boolean = false,
  authorizedRoleIds: readonly string[] = [],
): Promise<ChannelSetup> {
  const botMember = guild.members.me;
  if (!botMember) throw new Error('The bot guild member is unavailable; cannot create project channels safely.');
  const bootstrap = calculateProfile('bootstrap');
  const missingPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));
  if (missingPermissions.length > 0) {
    throw new Error(`Cannot create project channels; bot is missing required permissions: ${missingPermissions.join(', ')}`);
  }
  const runtime = calculateProfile('runtime');
  const botAllow = runtime.permissionNames
    .filter(permission => botMember.permissions?.has?.(permission) ?? false)
    .map(permission => permissionBitForCapability(
      runtime.capabilityIds.find(id => getCapability(id).permission === permission)!,
    ))
    .filter((permission): permission is bigint => permission !== undefined);
  const authorizedAllow = ['core.channel.view', 'core.message.send', 'core.message.history', 'task.thread.send']
    .map(permissionBitForCapability)
    .filter((permission): permission is bigint => permission !== undefined);
  const viewChannel = permissionBitForCapability('core.channel.view')!;

  const permissionOverwrites: OverwriteResolvable[] = [
    {
      id: guild.id,
      deny: [viewChannel],
    },
    {
      id: botMember.id,
      allow: botAllow,
    },
    ...authorizedRoleIds.map(id => ({ id, allow: authorizedAllow })),
  ];

  let category: import('discord.js').CategoryChannel | undefined;
  let agentChannel: import('discord.js').TextChannel | undefined;
  let roborevChannel: import('discord.js').TextChannel | undefined;
  try {
    category = await guild.channels.create({
      name: projectName,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
    });
    agentChannel = await guild.channels.create({
      name: 'agent',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Agent tasks for ${projectName}`,
    });
    if (includeRoborev) {
      roborevChannel = await guild.channels.create({
        name: 'roborev',
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Roborev code reviews for ${projectName}`,
      });
    }
    return {
      categoryId: category.id,
      agentChannelId: agentChannel.id,
      ...(roborevChannel ? { roborevChannelId: roborevChannel.id } : {}),
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const channel of [roborevChannel, agentChannel, category].reverse()) {
      try { await channel?.delete(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length > 0) {
      const details = cleanupErrors.map(item => item instanceof Error ? item.message : String(item)).join('; ');
      throw new Error(`${error instanceof Error ? error.message : String(error)}; channel compensation failed: ${details}`, { cause: error });
    }
    throw error;
  }
}

export async function deleteProjectChannels(
  guild: Guild,
  categoryId: string,
  agentChannelId: string,
  roborevChannelId?: string,
  options: { strict?: boolean } = {},
): Promise<void> {
  const errors: string[] = [];
  const deleteChannel = async (id: string) => {
    try {
      const ch = await guild.channels.fetch(id);
      if (ch) await ch.delete();
    } catch (error) {
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await deleteChannel(agentChannelId);
  if (roborevChannelId) {
    await deleteChannel(roborevChannelId);
  }
  await deleteChannel(categoryId);
  if (options.strict && errors.length > 0) {
    throw new Error(`Channel compensation failed: ${errors.join('; ')}`);
  }
}

export async function ensurePrimaryAgentChannel(
  guild: Guild,
  authorizedRoleIds: readonly string[],
  ownerId?: string,
  configuredChannelId?: string,
): Promise<import('discord.js').TextChannel> {
  const botMember = guild.members.me;
  if (!botMember) throw new Error('The bot guild member is unavailable; cannot create the primary agent channel safely.');
  const bootstrap = calculateProfile('bootstrap');
  const missingBootstrapPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));
  if (missingBootstrapPermissions.length > 0) {
    throw new Error(`Cannot create or reconcile the primary agent channel; bot is missing required permissions: ${missingBootstrapPermissions.join(', ')}`);
  }
  const runtime = calculateProfile('runtime');
  const requiredPermissions = runtime.permissionNames;
  const missingGuildPermissions = requiredPermissions.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));
  if (missingGuildPermissions.length > 0) {
    throw new Error(`Cannot use the primary agent channel; bot is missing required permissions: ${missingGuildPermissions.join(', ')}`);
  }
  const basicCapabilities = runtime.capabilityIds.filter(id => getCapability(id).permission);
  const botAllow = basicCapabilities
    .map(permissionBitForCapability)
    .filter((permission): permission is bigint => permission !== undefined)
    .filter(permission => botMember.permissions?.has?.(permission) ?? false);
  const authorizedAllow = [...basicCapabilities, 'task.thread.send']
    .map(permissionBitForCapability)
    .filter((permission): permission is bigint => permission !== undefined);
  const viewChannel = permissionBitForCapability('core.channel.view')!;
  const permissionOverwrites: OverwriteResolvable[] = [
    { id: guild.id, deny: [viewChannel] },
    { id: botMember.id, allow: botAllow },
    ...(ownerId ? [{ id: ownerId, allow: authorizedAllow }] : []),
    ...authorizedRoleIds.map(id => ({ id, allow: authorizedAllow })),
  ];
  let existing: import('discord.js').TextChannel | undefined;
  if (configuredChannelId) {
    const fetched = await guild.channels.fetch(configuredChannelId);
    if (!fetched || fetched.type !== ChannelType.GuildText) {
      throw new Error(`Configured primary channel "${configuredChannelId}" is missing or is not a text channel.`);
    }
    existing = fetched;
  }
  if (existing) {
    if (!existing.permissionOverwrites?.set) {
      throw new Error('Configured primary channel cannot reconcile its permission overwrites safely.');
    }
    await existing.permissionOverwrites.set(permissionOverwrites);
    const channelPermissions = existing.permissionsFor?.(botMember) ?? botMember.permissionsIn?.(existing);
    const missingChannelPermissions = requiredPermissions.filter(permission => !(channelPermissions?.has?.(permission) ?? false));
    if (missingChannelPermissions.length > 0) {
      throw new Error(`Cannot use the primary agent channel; bot is missing channel permissions: ${missingChannelPermissions.join(', ')}`);
    }
    if (ownerId) {
      const ownerPermissions = existing.permissionsFor?.(ownerId);
      const missingOwnerPermissions = requiredPermissions.filter(permission => !(ownerPermissions?.has?.(permission) ?? false));
      if (missingOwnerPermissions.length > 0) {
        throw new Error(`Cannot use the primary agent channel; owner is missing channel permissions: ${missingOwnerPermissions.join(', ')}`);
      }
    }
    return existing;
  }
  return guild.channels.create({ name: 'agent-chat', type: ChannelType.GuildText, topic: 'Primary project-owner agent', permissionOverwrites });
}

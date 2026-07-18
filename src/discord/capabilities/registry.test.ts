import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { CAPABILITIES } from './registry.js';
import { calculateProfile, DISCORD_CAPABILITY_PROFILES } from './profiles.js';

describe('Discord capability registry', () => {
  it('contains unique stable capability IDs with real Discord permission mappings', () => {
    const ids = CAPABILITIES.map(capability => capability.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of CAPABILITIES) {
      if (capability.permission) {
        expect(PermissionFlagsBits[capability.permission]).toBeTypeOf('bigint');
        expect(capability.permission).not.toBe('Administrator');
      }
    }
  });

  it('derives deterministic runtime and bootstrap profiles without Administrator', () => {
    const runtime = calculateProfile('runtime');
    const bootstrap = calculateProfile('bootstrap');

    expect(runtime.capabilityIds).toEqual([
      'core.guild.access',
      'core.channel.view',
      'core.message.send',
      'core.message.history',
      'task.thread.create.public',
      'task.thread.send',
    ]);
    expect(bootstrap.capabilityIds).toContain('workspace.channel.manage');
    expect(bootstrap.permissionNames).not.toContain('Administrator');
    expect(runtime.permissionBits).toBe(
      PermissionFlagsBits.ViewChannel
      | PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.ReadMessageHistory
      | PermissionFlagsBits.CreatePublicThreads
      | PermissionFlagsBits.SendMessagesInThreads,
    );
    expect(bootstrap.permissionBits).toBeGreaterThan(runtime.permissionBits);
    expect(DISCORD_CAPABILITY_PROFILES.optional).toContain('task.control-card.pin');
    expect(DISCORD_CAPABILITY_PROFILES.runtime).not.toContain('core.message.embed');
    expect(DISCORD_CAPABILITY_PROFILES.bootstrap).not.toContain('core.message.embed');
  });
});

import { GuildMember } from 'discord.js';
import { config } from '../config.js';

export function isAuthorized(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  return config.authorizedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

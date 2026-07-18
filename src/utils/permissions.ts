import { GuildMember } from 'discord.js';

function configuredRoleIds(): string[] {
  return (process.env.AUTHORIZED_ROLE_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
}

export function isAuthorized(
  member: GuildMember | null | undefined,
  authorizedRoleIds: readonly string[] = configuredRoleIds(),
): boolean {
  if (!member) return false;
  return authorizedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

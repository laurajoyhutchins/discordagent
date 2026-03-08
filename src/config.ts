import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  authorizedRoleIds: required('AUTHORIZED_ROLE_IDS').split(',').map(s => s.trim()),
  notifyUserId: process.env.NOTIFY_USER_ID ?? '',
  claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '900000', 10),
  roborevCliPath: process.env.ROBOREV_CLI_PATH ?? 'roborev',
} as const;

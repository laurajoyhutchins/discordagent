import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { commands } from '../commands/definitions.js';

interface DiscordObject { id?: string; name?: string; username?: string; }

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export interface DiscordConnectivityResult {
  readonly botUser: string;
  readonly guild: string;
  readonly authorizedRoles: readonly string[];
  readonly registeredCommands: readonly string[];
}

export async function checkDiscordConnectivity(): Promise<DiscordConnectivityResult> {
  const token = required('DISCORD_TOKEN');
  const clientId = required('DISCORD_CLIENT_ID');
  const guildId = required('DISCORD_GUILD_ID');
  const authorizedRoleIds = required('AUTHORIZED_ROLE_IDS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const rest = new REST({ version: '10' }).setToken(token);
  const [bot, guild, roles, registered] = await Promise.all([
    rest.get(Routes.user('@me')),
    rest.get(Routes.guild(guildId)),
    rest.get(Routes.guildRoles(guildId)),
    rest.get(Routes.applicationGuildCommands(clientId, guildId)),
  ]);

  const botRecord = bot as DiscordObject;
  const guildRecord = guild as DiscordObject;
  const roleRecords = roles as DiscordObject[];
  const commandRecords = registered as DiscordObject[];

  if (botRecord.id !== clientId) {
    throw new Error(`DISCORD_CLIENT_ID ${clientId} does not match the authenticated bot user ${botRecord.id ?? 'unknown'}.`);
  }

  const availableRoles = new Map(roleRecords.map(role => [role.id, role.name ?? role.id ?? 'unknown']));
  const missingRoles = authorizedRoleIds.filter(id => !availableRoles.has(id));
  if (missingRoles.length > 0) {
    throw new Error(`Authorized role(s) not found in guild: ${missingRoles.join(', ')}`);
  }

  const registeredNames = new Set(commandRecords.map(command => command.name).filter((name): name is string => Boolean(name)));
  const expectedNames = commands.map(command => command.name);
  const missingCommands = expectedNames.filter(name => !registeredNames.has(name));
  if (missingCommands.length > 0) {
    throw new Error(`Guild commands are missing: ${missingCommands.join(', ')}. Run npm run register or start the bot.`);
  }

  return {
    botUser: botRecord.username ?? botRecord.id ?? 'unknown',
    guild: guildRecord.name ?? guildRecord.id ?? 'unknown',
    authorizedRoles: authorizedRoleIds.map(id => availableRoles.get(id) ?? id),
    registeredCommands: expectedNames,
  };
}

async function main(): Promise<void> {
  const result = await checkDiscordConnectivity();
  console.log(`✓ Bot authentication: ${result.botUser}`);
  console.log(`✓ Guild access: ${result.guild}`);
  console.log(`✓ Authorized roles: ${result.authorizedRoles.join(', ')}`);
  console.log(`✓ Guild commands: ${result.registeredCommands.join(', ')}`);
  console.log('\nREADY — Discord REST connectivity is valid.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(`NOT READY — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { commands } from './definitions.js';
import { redactErrorMessage } from '../utils/redaction.js';

async function register() {
  const rest = new REST().setToken(config.discordToken);

  console.log('Registering slash commands...');

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log('Slash commands registered successfully.');
}

register().catch(error => console.error(redactErrorMessage(error)));

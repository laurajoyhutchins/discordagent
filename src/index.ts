import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { handleInteraction } from './handlers/interactionHandler.js';
import { handleMessage } from './handlers/messageHandler.js';
import { startRoborevWatcher } from './services/roborevWatcher.js';
import { commands } from './commands/definitions.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  // Register slash commands on startup
  try {
    const rest = new REST().setToken(config.discordToken);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }

  // Start roborev watcher
  try {
    startRoborevWatcher();
  } catch (err) {
    console.error('Failed to start roborev watcher:', err);
  }
});

client.on('interactionCreate', handleInteraction);
client.on('messageCreate', handleMessage);

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  client.destroy();
  process.exit(0);
});

client.login(config.discordToken);

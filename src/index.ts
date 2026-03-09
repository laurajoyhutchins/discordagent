import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { handleInteraction } from './handlers/interactionHandler.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleThreadDelete } from './handlers/threadDeleteHandler.js';
import { startRoborevWatcher, stopRoborevWatcher } from './services/roborevWatcher.js';
import { stopAllLoops } from './services/loopRunner.js';
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
client.on('threadDelete', handleThreadDelete);

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

function shutdown() {
  console.log('Shutting down...');
  stopAllLoops();
  stopRoborevWatcher();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.discordToken);

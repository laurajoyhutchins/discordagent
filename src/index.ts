import { createServer } from 'node:net';
import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { handleInteraction } from './handlers/interactionHandler.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleThreadDelete } from './handlers/threadDeleteHandler.js';
import { startRoborevWatcher, stopRoborevWatcher } from './services/roborevWatcher.js';
import { startRuntime, stopRuntime, type RuntimeServices } from './services/runtime.js';
import { stopAllLoops } from './services/loopRunner.js';
import { commands } from './commands/definitions.js';
import { redactErrorMessage } from './utils/redaction.js';
import { FactoryFloorClient } from './factoryFloor/client.js';
import { FactoryFloorBridgeService } from './factoryFloor/bridgeService.js';
import { createFactoryFloorRunRepository } from './repositories/factoryFloorRunRepository.js';
import {
  clearFactoryFloorBridgeService,
  setFactoryFloorBridgeService,
} from './services/factoryFloorBridgeRegistry.js';

// ── Single-instance lock ─────────────────────────────────────────────
// Multiple bot processes sharing one token cause duplicate message
// handling and interaction failures. Hold a localhost port as a mutex:
// a second instance gets EADDRINUSE and exits instead of connecting.
const LOCK_PORT = parseInt(process.env.INSTANCE_LOCK_PORT ?? '47831', 10);
const lockServer = createServer();
lockServer.unref();
lockServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Another Discord Agent instance is already running (lock port ${LOCK_PORT} in use). Exiting.`
    );
  } else {
    console.error('Instance lock error:', redactErrorMessage(err));
  }
  process.exit(1);
});
lockServer.listen(LOCK_PORT, '127.0.0.1', () => {
  console.log(`Instance lock acquired on port ${LOCK_PORT}.`);
  client.login(config.discordToken);
});

let runtime: RuntimeServices | null = null;
let factoryFloorBridge: FactoryFloorBridgeService | null = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  try {
    runtime = await startRuntime(client);
    if (config.factoryFloorEnabled) {
      const api = new FactoryFloorClient({
        baseUrl: config.factoryFloorBaseUrl,
        operatorToken: config.factoryFloorOperatorToken,
        timeoutMs: config.factoryFloorRequestTimeoutMs,
      });
      factoryFloorBridge = new FactoryFloorBridgeService(
        api,
        createFactoryFloorRunRepository(runtime.database),
        client,
        { pollIntervalMs: config.factoryFloorPollIntervalMs },
      );
      setFactoryFloorBridgeService(factoryFloorBridge);
      await factoryFloorBridge.start();
      console.log(`Factory Floor bridge enabled for ${config.factoryFloorBaseUrl}.`);
    }
  } catch (error) {
    clearFactoryFloorBridgeService();
    console.error('Failed to initialize Discord Agent runtime:', redactErrorMessage(error));
    process.exit(1);
    return;
  }

  // Do not accept work until the durable coordinator and recovery pass are ready.
  client.on('interactionCreate', handleInteraction);
  client.on('messageCreate', handleMessage);
  client.on('threadDelete', handleThreadDelete);

  // Register slash commands on startup
  try {
    const rest = new REST().setToken(config.discordToken);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', redactErrorMessage(err));
  }

  // Start roborev watcher (async — checks CLI availability first)
  startRoborevWatcher().catch(err => {
    console.error('Failed to start roborev watcher:', redactErrorMessage(err));
  });
});

client.on('error', (err) => {
  console.error('Discord client error:', redactErrorMessage(err));
});

// ── WebSocket health monitoring ──────────────────────────────────────
// Discord.js can maintain "zombie" connections where the gateway appears
// connected but messages aren't being delivered. These handlers detect
// and log disconnects/reconnects so we can diagnose message pickup delays.

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[shard ${shardId}] Disconnected (code ${event.code}). Waiting for reconnect...`);
});

client.on('shardReconnecting', (shardId) => {
  console.log(`[shard ${shardId}] Reconnecting...`);
});

client.on('shardResume', (shardId, replayedEvents) => {
  console.log(`[shard ${shardId}] Resumed. Replayed ${replayedEvents} events.`);
});

client.on('shardReady', (shardId) => {
  console.log(`[shard ${shardId}] Ready.`);
});

// Heartbeat watchdog: periodically check WebSocket ping to detect stale connections.
// If ping goes to -1 or becomes very high, the connection is likely stale.
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;  // Check every 30s
let lastKnownPing = -1;
let stalePingCount = 0;
let reconnecting = false;

setInterval(async () => {
  if (reconnecting) return;

  const ping = client.ws.ping;
  if (ping === -1 && lastKnownPing !== -1 && client.isReady()) {
    stalePingCount++;
    console.warn(`[heartbeat] WebSocket ping is -1 (stale count: ${stalePingCount})`);
    // After 3 consecutive stale checks (~90s), force reconnect
    if (stalePingCount >= 3) {
      console.warn('[heartbeat] Connection appears stale — destroying and reconnecting');
      stalePingCount = 0;
      lastKnownPing = -1;
      reconnecting = true;
      try {
        await client.destroy();
        await client.login(config.discordToken);
        console.log('[heartbeat] Reconnected successfully');
      } catch (err) {
        console.error('[heartbeat] Reconnect failed, exiting so the process manager can restart us:', redactErrorMessage(err));
        process.exit(1);
      } finally {
        reconnecting = false;
      }
    }
  } else {
    if (stalePingCount > 0) {
      console.log(`[heartbeat] Connection restored (ping: ${ping}ms)`);
    }
    stalePingCount = 0;
    lastKnownPing = ping;
  }
}, HEARTBEAT_CHECK_INTERVAL_MS);

async function shutdown(): Promise<void> {
  console.log('Shutting down...');
  stopAllLoops();
  stopRoborevWatcher();
  clearFactoryFloorBridgeService();
  factoryFloorBridge = null;
  if (runtime) await stopRuntime(runtime);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
// Login happens in the lockServer.listen callback above, once the
// single-instance lock is held.

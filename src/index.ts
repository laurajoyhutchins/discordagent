import { createServer } from 'node:net';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type AnyThreadChannel,
  type TextChannel,
} from 'discord.js';
import { config, isTerminalReplEnabled } from './config.js';
import { handleInteraction } from './handlers/interactionHandler.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleThreadDelete } from './handlers/threadDeleteHandler.js';
import { startRuntime, stopRuntime, type RuntimeServices } from './services/runtime.js';
import {
  clearLoopRunner,
  configureLoopRunner,
  reconcileScheduledLoops,
  stopAllLoops,
} from './services/loopRunner.js';
import { commands } from './commands/definitions.js';
import { redactErrorMessage } from './utils/redaction.js';
import { PROCESS_GATEWAY_INTENTS } from './discord/capabilities/registry.js';
import { getAllProjects } from './services/projectStore.js';
import { createLoopRepository } from './repositories/loopRepository.js';
import { createRoborevReviewSource, deliverRoborevNotification } from './integrations/roborev/index.js';
import type { Disposable, ReviewNotification } from './integrations/reviewSource.js';
import { Repl } from './terminal/repl.js';
import { activatePrimaryProvider } from './services/agentRuntimeService.js';

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
let reviewSourceDisposable: Disposable | undefined;
let repl: Repl | undefined;
let shuttingDown = false;

async function handleReviewNotification(
  notification: ReviewNotification,
): Promise<void> {
  const project = getAllProjects().find(
    p => p.name === notification.projectId,
  );
  if (!project?.roborevChannelId) return;

  const channel = await client.channels.fetch(project.roborevChannelId)
    .catch(() => null);
  if (!channel || !('send' in channel)) return;
  await deliverRoborevNotification(channel as TextChannel, notification, {
    logger: message => console.warn(`[roborev] ${message}`),
  });
}

async function fetchLoopThread(threadId: string): Promise<AnyThreadChannel | null> {
  const channel = await client.channels.fetch(threadId).catch(() => null);
  return channel?.isThread() ? channel : null;
}

const client = new Client({
  intents: PROCESS_GATEWAY_INTENTS.map(intent => GatewayIntentBits[intent]),
  partials: [Partials.Message, Partials.Channel],
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  try {
    runtime = await startRuntime(client);
    configureLoopRunner({
      repository: createLoopRepository(runtime.database),
      coordinator: runtime.coordinator,
      fetchThread: fetchLoopThread,
      findProject: name => runtime?.projects.findByName(name),
      logger: message => console.warn(message),
    });
    await reconcileScheduledLoops();
  } catch (error) {
    console.error('Failed to initialize Discord Agent runtime:', redactErrorMessage(error));
    clearLoopRunner();
    if (runtime) await stopRuntime(runtime).catch(() => undefined);
    process.exit(1);
    return;
  }

  // Do not accept work until durable task and scheduled-loop recovery are ready.
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

  // Start review sources through the generic lifecycle boundary
  {
    const source = createRoborevReviewSource();
    reviewSourceDisposable = await source.start(handleReviewNotification)
      .catch(err => {
        console.error('[roborev] Failed to start review source:', redactErrorMessage(err));
        return undefined;
      });
  }

  // Start the terminal REPL if enabled
  if (isTerminalReplEnabled() && runtime.primaryAgent && runtime.conversationService) {
    if (!runtime.providers || !runtime.settingsService) {
      console.warn('[repl] Runtime is not fully initialized for the terminal REPL');
    } else {
      const ownerId = runtime.primaryAgent.ownerId;
      if (!ownerId) {
        console.warn('[repl] No primary agent owner configured; terminal REPL requires AUTHORIZED_USER_ID');
      } else {
        const globalSetting = runtime.settingsService.global();
        const provider = globalSetting.defaultProvider;
        const providerLabel = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'none';
        console.log(`Primary provider: ${providerLabel}`);
        repl = new Repl({
          conversationService: runtime.conversationService,
          ownerId,
          displayName: 'user',
          projects: runtime.projects,
          tasks: runtime.tasks,
          providers: runtime.providers,
          settings: runtime.settingsService,
          isDiscordConnected: () => client.isReady(),
          activatePrimaryProvider,
          onExitRepl: () => {
            // /exit was entered — just stop the REPL, leave the bot running
          },
          onSigintShutdown: () => {
            void shutdown();
          },
        });
        repl.start().catch((err: unknown) => {
          console.error('[repl] Failed to start terminal REPL:', redactErrorMessage(err));
        });
      }
    }
  }
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
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down...');
  if (repl) await repl.stop();
  stopAllLoops();
  clearLoopRunner();
  if (reviewSourceDisposable) await reviewSourceDisposable.dispose();
  if (runtime) await stopRuntime(runtime);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
// Login happens in the lockServer.listen callback above, once the
// single-instance lock is held.

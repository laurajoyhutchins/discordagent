import type { GuildMember } from 'discord.js';
import { isAuthorized } from '../utils/permissions.js';
import {
  activityBootstrapConfigFromEnv,
  type ActivityBootstrapServerConfig,
} from './activityBootstrapConfig.js';
import {
  createActivityBootstrapHttpHandler,
} from './activityBootstrapHttp.js';
import {
  createActivityBootstrapService,
  type ActivityBootstrapDependencies,
  type ActivityBootstrapService,
} from './activityBootstrapService.js';
import {
  startActivityBootstrapServer,
  type ActivityBootstrapServerHandle,
  type StartActivityBootstrapServerOptions,
} from './activityBootstrapServer.js';
import {
  DiscordActivityApiClient,
  type DiscordActivityApiClientOptions,
} from './discordOAuthClient.js';
import type { FactoryFloorRuntimeServices } from './runtime.js';

export interface ActivityBootstrapGuildClient {
  guilds: {
    fetch(guildId: string): Promise<{
      members: {
        fetch(userId: string): Promise<GuildMember>;
      };
    }>;
  };
}

export interface StartOptionalActivityBootstrapBrokerOptions {
  env?: Record<string, string | undefined>;
  applicationId: string;
  botToken: string;
  client: ActivityBootstrapGuildClient;
  runtime: FactoryFloorRuntimeServices;
  authorize?: (member: GuildMember | null) => boolean;
  logger?: (message: string) => void;
  createDiscordClient?: (
    options: DiscordActivityApiClientOptions,
  ) => Pick<
    DiscordActivityApiClient,
    'getActivityInstance' | 'exchangeAuthorizationCode' | 'getCurrentUser'
  >;
  createService?: (
    dependencies: ActivityBootstrapDependencies,
  ) => ActivityBootstrapService;
  startServer?: (
    options: StartActivityBootstrapServerOptions,
  ) => Promise<ActivityBootstrapServerHandle>;
}

function discordClientOptions(
  config: ActivityBootstrapServerConfig,
  applicationId: string,
  botToken: string,
): DiscordActivityApiClientOptions {
  return {
    applicationId,
    clientSecret: config.discordClientSecret,
    botToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  };
}

export async function startOptionalActivityBootstrapBroker(
  options: StartOptionalActivityBootstrapBrokerOptions,
): Promise<ActivityBootstrapServerHandle | undefined> {
  const config = activityBootstrapConfigFromEnv(options.env ?? process.env);
  if (!config) return undefined;

  const createDiscordClient = options.createDiscordClient
    ?? (clientOptions => new DiscordActivityApiClient(clientOptions));
  const createService = options.createService ?? createActivityBootstrapService;
  const startServer = options.startServer ?? startActivityBootstrapServer;
  const authorize = options.authorize ?? isAuthorized;
  const logger = options.logger ?? (message => console.warn(message));
  const discord = createDiscordClient(
    discordClientOptions(config, options.applicationId, options.botToken),
  );
  const service = createService({
    applicationId: options.applicationId,
    oauthScopes: config.oauthScopes,
    oauthTtlMs: config.oauthTtlMs,
    allowedRedirectUris: config.redirectUris,
    discord,
    launchLookup: options.runtime.launchLookup,
    launches: options.runtime.launches,
    oauth: options.runtime.oauth,
    factoryFloor: options.runtime.serviceClient,
    async resolveMember(guildId, userId) {
      try {
        const guild = await options.client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return {
          userId: member.id,
          authorized: authorize(member),
        };
      } catch {
        return undefined;
      }
    },
  });
  const handler = createActivityBootstrapHttpHandler({
    service,
    allowedOrigins: config.allowedOrigins,
    maxBodyBytes: config.maxBodyBytes,
    logger,
  });
  return startServer({ config, handler, logger });
}
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
  createActivityBootstrapSessionClient,
} from './activityBootstrapSessionClient.js';
import {
  createActivityBootstrapService,
  type ActivityBootstrapDependencies,
  type ActivityBootstrapService,
} from './activityBootstrapService.js';
import {
  createActivityRevalidationService,
  type ActivityRevalidationDependencies,
  type ActivityRevalidationMemberResolution,
  type ActivityRevalidationService,
} from './activityRevalidationService.js';
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
  guildId: string;
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
  createRevalidationService?: (
    dependencies: ActivityRevalidationDependencies,
  ) => ActivityRevalidationService;
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

function errorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; code?: unknown };
  if (typeof value.status === 'number') return value.status;
  if (typeof value.code === 'number') return value.code;
  if (typeof value.code === 'string' && /^\d+$/.test(value.code)) {
    return Number(value.code);
  }
  return undefined;
}

export async function startOptionalActivityBootstrapBroker(
  options: StartOptionalActivityBootstrapBrokerOptions,
): Promise<ActivityBootstrapServerHandle | undefined> {
  const config = activityBootstrapConfigFromEnv(options.env ?? process.env);
  if (!config) return undefined;

  const createDiscordClient = options.createDiscordClient
    ?? (clientOptions => new DiscordActivityApiClient(clientOptions));
  const createService = options.createService ?? createActivityBootstrapService;
  const createRevalidation = options.createRevalidationService
    ?? createActivityRevalidationService;
  const startServer = options.startServer ?? startActivityBootstrapServer;
  const authorize = options.authorize ?? isAuthorized;
  const logger = options.logger ?? (message => console.warn(message));
  const discord = createDiscordClient(
    discordClientOptions(config, options.applicationId, options.botToken),
  );
  const resolveCurrentMember = async (
    guildId: string,
    userId: string,
  ): Promise<
    | { kind: 'member'; member: GuildMember }
    | { kind: 'missing' }
    | { kind: 'unavailable' }
  > => {
    try {
      const guild = await options.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return { kind: 'member', member };
    } catch (error) {
      const status = errorStatus(error);
      return status === 404 || status === 10_007
        ? { kind: 'missing' }
        : { kind: 'unavailable' };
    }
  };
  const bootstrapFactoryFloor = createActivityBootstrapSessionClient({
    bindings: options.runtime.bindings,
    activityInstances: options.runtime.activityInstances,
    factoryFloor: options.runtime.serviceClient,
  });
  const service = createService({
    applicationId: options.applicationId,
    oauthScopes: config.oauthScopes,
    oauthTtlMs: config.oauthTtlMs,
    allowedRedirectUris: config.redirectUris,
    discord,
    launchLookup: options.runtime.launchLookup,
    launches: options.runtime.launches,
    oauth: options.runtime.oauth,
    factoryFloor: bootstrapFactoryFloor,
    async resolveMember(guildId, userId) {
      const resolution = await resolveCurrentMember(guildId, userId);
      return resolution.kind === 'member'
        ? {
            userId: resolution.member.id,
            authorized: authorize(resolution.member),
          }
        : undefined;
    },
  });
  const revalidationService = createRevalidation({
    applicationId: options.applicationId,
    guildId: options.guildId,
    adapter: 'discord-agent',
    timeoutMs: config.requestTimeoutMs,
    maxRequests: config.revalidationMaxRequests,
    rateLimitWindowMs: config.revalidationRateLimitWindowMs,
    discord,
    bindings: options.runtime.bindings,
    async resolveMember(guildId, userId) {
      const resolution = await resolveCurrentMember(guildId, userId);
      let result: ActivityRevalidationMemberResolution;
      if (resolution.kind === 'member') {
        result = {
          kind: 'member',
          userId: resolution.member.id,
          authorized: authorize(resolution.member),
        };
      } else {
        result = resolution;
      }
      return result;
    },
    onDecision(decision) {
      logger(
        `[factoryFloor] Activity ${decision.action || 'unknown'} revalidation ${decision.allowed ? 'allowed' : 'denied'} (${decision.reasonCode}).`,
      );
    },
  });
  const handler = createActivityBootstrapHttpHandler({
    service,
    allowedOrigins: config.allowedOrigins,
    maxBodyBytes: config.maxBodyBytes,
    logger,
    revalidation: {
      service: revalidationService,
      auth: {
        keys: options.runtime.config.serviceAuthKeys,
        nonceStore: options.runtime.nonceStore,
      },
    },
  });
  return startServer({ config, handler, logger });
}

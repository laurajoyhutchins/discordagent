import type { DatabaseHandle } from '../db/database.js';
import {
  createFactoryFloorBindingRepository,
  createFactoryFloorNonceStore,
  type FactoryFloorBindingRepository,
} from '../repositories/factoryFloorBindingRepository.js';
import {
  createFactoryFloorLaunchInteractionLookup,
  type FactoryFloorLaunchInteractionLookup,
} from '../repositories/factoryFloorLaunchInteractionLookup.js';
import {
  createFactoryFloorLaunchRepository,
  type FactoryFloorLaunchRepository,
} from '../repositories/factoryFloorLaunchRepository.js';
import {
  createFactoryFloorOAuthRepository,
  type FactoryFloorOAuthRepository,
} from '../repositories/factoryFloorOAuthRepository.js';
import { createProjectRepository } from '../repositories/projectRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';
import {
  createFactoryFloorActivityLaunchBindingLookup,
  createFactoryFloorActivityLaunchService,
  type FactoryFloorActivityLaunchService,
} from './activityLaunchService.js';
import {
  FactoryFloorOperatorClient,
  FactoryFloorServiceClient,
} from './client.js';
import {
  factoryFloorConfigFromEnv,
  type FactoryFloorIntegrationConfig,
} from './config.js';
import type { ServiceAuthNonceStore } from './serviceAuth.js';

export interface FactoryFloorRuntimeServices {
  readonly config: FactoryFloorIntegrationConfig;
  readonly bindings: FactoryFloorBindingRepository;
  readonly launches: FactoryFloorLaunchRepository;
  readonly launchLookup: FactoryFloorLaunchInteractionLookup;
  readonly oauth: FactoryFloorOAuthRepository;
  readonly activityLaunch: FactoryFloorActivityLaunchService;
  readonly nonceStore: ServiceAuthNonceStore;
  readonly serviceClient: FactoryFloorServiceClient;
  readonly operatorClient?: FactoryFloorOperatorClient;
}

export interface InitializeFactoryFloorRuntimeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly applicationId?: string;
  readonly guildId?: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: (message: string) => void;
}

let activeRuntime: FactoryFloorRuntimeServices | undefined;

export function initializeFactoryFloorRuntime(
  database: DatabaseHandle,
  options: InitializeFactoryFloorRuntimeOptions = {},
): FactoryFloorRuntimeServices | undefined {
  clearFactoryFloorRuntime();
  const logger = options.logger ?? (message => console.warn(message));
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;

  let config: FactoryFloorIntegrationConfig | undefined;
  try {
    config = factoryFloorConfigFromEnv(env);
  } catch (error) {
    logger(
      `[factoryFloor] Adapter disabled because configuration is invalid: ${redactErrorMessage(error)}`,
    );
    return undefined;
  }
  if (!config) return undefined;

  try {
    const applicationId = (options.applicationId ?? env.DISCORD_CLIENT_ID)?.trim();
    if (!applicationId) {
      throw new Error('DISCORD_CLIENT_ID is required for Factory Floor Activity launches');
    }
    const guildId = (options.guildId ?? env.DISCORD_GUILD_ID)?.trim();
    if (!guildId) {
      throw new Error('DISCORD_GUILD_ID is required for Factory Floor Activity launches');
    }
    const requestOptions = {
      baseUrl: config.baseUrl,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    };
    const bindings = createFactoryFloorBindingRepository(database);
    const launches = createFactoryFloorLaunchRepository(database);
    const launchLookup = createFactoryFloorLaunchInteractionLookup(database);
    const oauth = createFactoryFloorOAuthRepository(database);
    const cleanedOAuth = oauth.cleanup(now());
    const cleanedLaunches = launches.cleanup(now());
    if (cleanedOAuth > 0 || cleanedLaunches > 0) {
      logger(
        `[factoryFloor] Cleaned ${cleanedLaunches} launch registration(s) and ${cleanedOAuth} OAuth attempt(s).`,
      );
    }
    const projects = createProjectRepository(database);
    const runtime: FactoryFloorRuntimeServices = {
      config,
      bindings,
      launches,
      launchLookup,
      oauth,
      activityLaunch: createFactoryFloorActivityLaunchService({
        expectedApplicationId: applicationId,
        expectedGuildId: guildId,
        findProjectByChannelId: channelId => {
          const project = projects.findByChannelId(channelId);
          return project?.agentChannelId === channelId ? project : undefined;
        },
        bindings: createFactoryFloorActivityLaunchBindingLookup(database),
        launches,
        now,
        launchTtlMs: config.launchTtlMs,
      }),
      nonceStore: createFactoryFloorNonceStore(database),
      serviceClient: new FactoryFloorServiceClient({
        ...requestOptions,
        keys: config.serviceAuthKeys,
      }),
      ...(config.operatorToken
        ? {
            operatorClient: new FactoryFloorOperatorClient({
              ...requestOptions,
              operatorToken: config.operatorToken,
            }),
          }
        : {}),
    };
    activeRuntime = runtime;
    return runtime;
  } catch (error) {
    logger(
      `[factoryFloor] Adapter initialization failed; direct providers remain available: ${redactErrorMessage(error)}`,
    );
    return undefined;
  }
}

export function getFactoryFloorRuntime(): FactoryFloorRuntimeServices | undefined {
  return activeRuntime;
}

export function clearFactoryFloorRuntime(): void {
  activeRuntime = undefined;
}
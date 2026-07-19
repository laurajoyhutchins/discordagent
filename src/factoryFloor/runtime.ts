import type { DatabaseHandle } from '../db/database.js';
import {
  createFactoryFloorBindingRepository,
  type FactoryFloorBindingRepository,
} from '../repositories/factoryFloorBindingRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';
import {
  FactoryFloorOperatorClient,
  FactoryFloorServiceClient,
} from './client.js';
import {
  factoryFloorConfigFromEnv,
  type FactoryFloorIntegrationConfig,
} from './config.js';

export interface FactoryFloorRuntimeServices {
  readonly config: FactoryFloorIntegrationConfig;
  readonly bindings: FactoryFloorBindingRepository;
  readonly serviceClient: FactoryFloorServiceClient;
  readonly operatorClient?: FactoryFloorOperatorClient;
}

export interface InitializeFactoryFloorRuntimeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetchFn?: typeof fetch;
  readonly logger?: (message: string) => void;
}

let activeRuntime: FactoryFloorRuntimeServices | undefined;

export function initializeFactoryFloorRuntime(
  database: DatabaseHandle,
  options: InitializeFactoryFloorRuntimeOptions = {},
): FactoryFloorRuntimeServices | undefined {
  clearFactoryFloorRuntime();
  const logger = options.logger ?? (message => console.warn(message));

  let config: FactoryFloorIntegrationConfig | undefined;
  try {
    config = factoryFloorConfigFromEnv(options.env ?? process.env);
  } catch (error) {
    logger(
      `[factoryFloor] Adapter disabled because configuration is invalid: ${redactErrorMessage(error)}`,
    );
    return undefined;
  }
  if (!config) return undefined;

  try {
    const requestOptions = {
      baseUrl: config.baseUrl,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    };
    const runtime: FactoryFloorRuntimeServices = {
      config,
      bindings: createFactoryFloorBindingRepository(database),
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

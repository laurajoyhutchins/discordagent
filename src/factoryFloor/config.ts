import type { ServiceAuthKeys } from './serviceAuth.js';

export interface FactoryFloorIntegrationConfig {
  baseUrl: string;
  serviceAuthKeys: ServiceAuthKeys;
  operatorToken?: string;
  requestTimeoutMs: number;
  maxRetries: number;
}

function requiredEnv(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required when Factory Floor is enabled`);
  return value;
}

function optionalEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return env[key]?.trim() || undefined;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum?: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const upper = maximum ?? Number.MAX_SAFE_INTEGER;
    throw new Error(`${key} must be an integer between ${minimum} and ${upper}`);
  }
  return parsed;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FACTORY_FLOOR_BASE_URL must be a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('FACTORY_FLOOR_BASE_URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('FACTORY_FLOOR_BASE_URL must not contain credentials');
  }
  if (url.search || url.hash) {
    throw new Error('FACTORY_FLOOR_BASE_URL must not contain a query or fragment');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('FACTORY_FLOOR_BASE_URL must be an origin without a path');
  }
  url.pathname = '/';
  return url.toString();
}

function assertDistinctCredentials(
  keys: ServiceAuthKeys,
  operatorToken: string | undefined,
): void {
  const agentDirection = [
    keys.agentToFactoryKey,
    keys.previousAgentToFactoryKey,
  ].filter((value): value is string => Boolean(value));
  const factoryDirection = [
    keys.factoryToAgentKey,
    keys.previousFactoryToAgentKey,
  ].filter((value): value is string => Boolean(value));

  if (new Set(agentDirection).size !== agentDirection.length) {
    throw new Error('Factory Floor current and previous agent-to-factory keys must be distinct');
  }
  if (new Set(factoryDirection).size !== factoryDirection.length) {
    throw new Error('Factory Floor current and previous factory-to-agent keys must be distinct');
  }
  if (agentDirection.some(key => factoryDirection.includes(key))) {
    throw new Error('Factory Floor directional service-authentication keys must be distinct');
  }

  const serviceKeys = [...agentDirection, ...factoryDirection];
  if (operatorToken && serviceKeys.includes(operatorToken)) {
    throw new Error('Factory Floor operator and service-authentication credentials must be distinct');
  }
}

export function factoryFloorConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): FactoryFloorIntegrationConfig | undefined {
  if (env.FACTORY_FLOOR_ENABLED !== 'true') return undefined;

  const serviceAuthKeys: ServiceAuthKeys = {
    agentToFactoryKey: requiredEnv(env, 'FACTORY_FLOOR_AGENT_TO_FACTORY_KEY'),
    factoryToAgentKey: requiredEnv(env, 'FACTORY_FLOOR_FACTORY_TO_AGENT_KEY'),
    previousAgentToFactoryKey: optionalEnv(
      env,
      'FACTORY_FLOOR_PREVIOUS_AGENT_TO_FACTORY_KEY',
    ),
    previousFactoryToAgentKey: optionalEnv(
      env,
      'FACTORY_FLOOR_PREVIOUS_FACTORY_TO_AGENT_KEY',
    ),
  };
  const operatorToken = optionalEnv(env, 'FACTORY_FLOOR_OPERATOR_TOKEN');
  assertDistinctCredentials(serviceAuthKeys, operatorToken);

  return {
    baseUrl: normalizeBaseUrl(requiredEnv(env, 'FACTORY_FLOOR_BASE_URL')),
    serviceAuthKeys,
    ...(operatorToken ? { operatorToken } : {}),
    requestTimeoutMs: boundedInteger(
      env.FACTORY_FLOOR_REQUEST_TIMEOUT_MS,
      15_000,
      'FACTORY_FLOOR_REQUEST_TIMEOUT_MS',
      1,
    ),
    maxRetries: boundedInteger(
      env.FACTORY_FLOOR_MAX_RETRIES,
      1,
      'FACTORY_FLOOR_MAX_RETRIES',
      0,
      3,
    ),
  };
}

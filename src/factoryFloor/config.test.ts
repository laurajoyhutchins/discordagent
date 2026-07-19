import { describe, expect, it } from 'vitest';
import { factoryFloorConfigFromEnv } from './config.js';

const enabled = {
  FACTORY_FLOOR_ENABLED: 'true',
  FACTORY_FLOOR_BASE_URL: 'https://factory.example',
  FACTORY_FLOOR_AGENT_TO_FACTORY_KEY: 'agent-key',
  FACTORY_FLOOR_FACTORY_TO_AGENT_KEY: 'factory-key',
};

describe('factoryFloorConfigFromEnv', () => {
  it('keeps the optional integration disabled without affecting startup', () => {
    expect(factoryFloorConfigFromEnv({})).toBeUndefined();
    expect(factoryFloorConfigFromEnv({
      FACTORY_FLOOR_BASE_URL: 'not-used-while-disabled',
    })).toBeUndefined();
  });

  it('validates enabled configuration and keeps credentials distinct', () => {
    const config = factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_OPERATOR_TOKEN: 'operator-token',
      FACTORY_FLOOR_REQUEST_TIMEOUT_MS: '12000',
      FACTORY_FLOOR_MAX_RETRIES: '2',
    });

    expect(config).toEqual({
      baseUrl: 'https://factory.example/',
      serviceAuthKeys: {
        agentToFactoryKey: 'agent-key',
        factoryToAgentKey: 'factory-key',
        previousAgentToFactoryKey: undefined,
        previousFactoryToAgentKey: undefined,
      },
      operatorToken: 'operator-token',
      requestTimeoutMs: 12000,
      maxRetries: 2,
    });

    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_FACTORY_TO_AGENT_KEY: 'agent-key',
    })).toThrow(/directional.*distinct/i);

    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_PREVIOUS_AGENT_TO_FACTORY_KEY: 'factory-key',
    })).toThrow(/directional.*distinct/i);

    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_PREVIOUS_AGENT_TO_FACTORY_KEY: 'agent-key',
    })).toThrow(/current and previous.*distinct/i);

    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_OPERATOR_TOKEN: 'agent-key',
    })).toThrow(/operator.*distinct/i);
  });

  it('fails deterministic validation when enabled configuration is incomplete', () => {
    expect(() => factoryFloorConfigFromEnv({
      FACTORY_FLOOR_ENABLED: 'true',
    })).toThrow('FACTORY_FLOOR_AGENT_TO_FACTORY_KEY is required');
    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_BASE_URL: 'file:///tmp/factory-floor',
    })).toThrow(/http or https/i);
    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_BASE_URL: 'https://factory.example/control-plane',
    })).toThrow(/origin without a path/i);
    expect(() => factoryFloorConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_REQUEST_TIMEOUT_MS: '0',
    })).toThrow(/between 1/i);
  });
});

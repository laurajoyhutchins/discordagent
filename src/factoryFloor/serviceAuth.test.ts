import { describe, expect, it } from 'vitest';
import {
  formatServiceAuthHeader,
  signServiceRequest,
  verifyServiceRequest,
  type ServiceAuthKeys,
  type ServiceAuthNonceStore,
} from './serviceAuth.js';

const keys: ServiceAuthKeys = {
  agentToFactoryKey: 'agent-to-factory-current',
  factoryToAgentKey: 'factory-to-agent-current',
};

function nonceStore(): ServiceAuthNonceStore {
  const consumed = new Set<string>();
  return {
    consumeNonce(keyId, nonce) {
      const key = `${keyId}:${nonce}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  };
}

describe('Factory Floor service authentication', () => {
  it('signs exact request bytes and rejects replay', async () => {
    const now = 1_750_000_000_000;
    const body = JSON.stringify({ instanceId: 'activity-1' });
    const signed = signServiceRequest(
      keys,
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions',
      body,
      now,
      'nonce-1',
    );
    const header = formatServiceAuthHeader(signed);
    const store = nonceStore();

    await expect(verifyServiceRequest(
      { keys, nonceStore: store },
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions',
      body,
      header,
      now,
    )).resolves.toBeUndefined();

    await expect(verifyServiceRequest(
      { keys, nonceStore: store },
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions',
      body,
      header,
      now,
    )).rejects.toThrow('service_auth_nonce_replayed');
  });

  it('fails closed for changed bodies, stale timestamps, and wrong direction', async () => {
    const now = 1_750_000_000_000;
    const body = '{"value":1}';
    const header = formatServiceAuthHeader(signServiceRequest(
      keys,
      'agent-to-ff',
      'POST',
      '/callback',
      body,
      now,
      'nonce-2',
    ));

    await expect(verifyServiceRequest(
      { keys, nonceStore: nonceStore() },
      'agent-to-ff',
      'POST',
      '/callback',
      '{"value":2}',
      header,
      now,
    )).rejects.toThrow('service_auth_signature_mismatch');

    await expect(verifyServiceRequest(
      { keys, nonceStore: nonceStore() },
      'agent-to-ff',
      'POST',
      '/callback',
      body,
      header,
      now + 30_001,
    )).rejects.toThrow('service_auth_timestamp_skew');

    await expect(verifyServiceRequest(
      { keys, nonceStore: nonceStore() },
      'ff-to-agent',
      'POST',
      '/callback',
      body,
      header,
      now,
    )).rejects.toThrow('service_auth_unknown_key');
  });

  it('accepts the previous directional key during rotation', async () => {
    const now = 1_750_000_000_000;
    const oldKeys: ServiceAuthKeys = {
      agentToFactoryKey: 'agent-to-factory-old',
      factoryToAgentKey: keys.factoryToAgentKey,
    };
    const rotatingKeys: ServiceAuthKeys = {
      ...keys,
      previousAgentToFactoryKey: oldKeys.agentToFactoryKey,
    };
    const body = '{}';
    const header = formatServiceAuthHeader(signServiceRequest(
      oldKeys,
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions/refresh',
      body,
      now,
      'nonce-rotation',
    ));

    await expect(verifyServiceRequest(
      { keys: rotatingKeys, nonceStore: nonceStore() },
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions/refresh',
      body,
      header,
      now,
    )).resolves.toBeUndefined();
  });
});

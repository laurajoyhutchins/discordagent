import { describe, expect, it } from 'vitest';
import {
  FactoryFloorClientError,
  FactoryFloorOperatorClient,
  FactoryFloorServiceClient,
  type CreateActivitySessionRequest,
} from './client.js';
import { verifyServiceRequest, type ServiceAuthKeys } from './serviceAuth.js';

const keys: ServiceAuthKeys = {
  agentToFactoryKey: 'agent-to-factory-key',
  factoryToAgentKey: 'factory-to-agent-key',
};

describe('FactoryFloorServiceClient', () => {
  it('signs the exact JSON body for the versioned Activity session boundary', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    let capturedHeaders = new Headers();
    const fetchFn: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        instanceBindingId: 'binding-1',
        sessionToken: 'opaque-session-token',
        expiresAt: '2026-07-19T01:00:00.000Z',
        idleExpiresAt: '2026-07-19T00:45:00.000Z',
      }), { status: 201 });
    };
    const client = new FactoryFloorServiceClient({
      baseUrl: 'https://factory.example',
      keys,
      fetchFn,
      now: () => 1_750_000_000_000,
      nonce: () => 'nonce-client-1',
    });
    const input: CreateActivitySessionRequest = {
      applicationId: 'app-1',
      instanceId: 'instance-1',
      installationId: 'installation-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      launchId: 'launch-1',
      principalId: 'discord:user-1',
      adapter: 'discord-agent',
      boundRunId: 'run-1',
    };

    const response = await client.createOrJoinActivitySession(input);

    expect(response.instanceBindingId).toBe('binding-1');
    expect(capturedUrl).toBe('https://factory.example/api/v1/discord/activity/sessions');
    expect(capturedBody).toBe(JSON.stringify(input));
    expect(capturedHeaders.get('authorization')).toBeNull();
    await expect(verifyServiceRequest(
      {
        keys,
        nonceStore: { consumeNonce: () => true },
      },
      'agent-to-ff',
      'POST',
      '/api/v1/discord/activity/sessions',
      capturedBody,
      capturedHeaders.get('x-factory-floor-service-auth') ?? undefined,
      1_750_000_000_000,
    )).resolves.toBeUndefined();
  });

  it('maps remote errors without exposing response bodies or credentials', async () => {
    const client = new FactoryFloorServiceClient({
      baseUrl: 'https://factory.example',
      keys,
      fetchFn: async () => new Response(JSON.stringify({
        error: {
          code: 'service_auth_signature_mismatch',
          message: 'do not leak super-secret-key',
        },
      }), { status: 401 }),
    });

    let caught: unknown;
    try {
      await client.refreshActivitySession('opaque-session-token');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FactoryFloorClientError);
    expect(caught).toMatchObject({
      kind: 'unauthorized',
      code: 'service_auth_signature_mismatch',
      status: 401,
    });
    expect(String(caught)).not.toContain('super-secret-key');
    expect(String(caught)).not.toContain('opaque-session-token');
  });
});

describe('FactoryFloorOperatorClient', () => {
  it('keeps operator authentication separate and retries bounded read failures', async () => {
    let attempts = 0;
    let lastHeaders = new Headers();
    const client = new FactoryFloorOperatorClient({
      baseUrl: 'https://factory.example',
      operatorToken: 'operator-token',
      maxRetries: 1,
      fetchFn: async (_input, init) => {
        attempts += 1;
        lastHeaders = new Headers(init?.headers);
        if (attempts === 1) {
          return new Response(JSON.stringify({
            error: { code: 'temporarily_unavailable' },
          }), { status: 503 });
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    await expect(client.getStatus('discord:user-1')).resolves.toEqual({ status: 'ok' });
    expect(attempts).toBe(2);
    expect(lastHeaders.get('authorization')).toBe('Bearer operator-token');
    expect(lastHeaders.get('x-factory-floor-service-auth')).toBeNull();
    expect(lastHeaders.get('x-factory-floor-principal-id')).toBe('discord:user-1');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createActivityBootstrapHttpHandler } from './activityBootstrapHttp.js';
import type { ActivityRevalidationService } from './activityRevalidationService.js';
import {
  formatServiceAuthHeader,
  signServiceRequest,
  type ServiceAuthKeys,
} from './serviceAuth.js';

const path = '/api/v1/discord/activity/revalidate';
const keys: ServiceAuthKeys = {
  agentToFactoryKey: 'agent-current-secret',
  factoryToAgentKey: 'factory-current-secret',
  previousAgentToFactoryKey: 'agent-previous-secret',
  previousFactoryToAgentKey: 'factory-previous-secret',
};

const payload = {
  applicationId: 'application-1',
  instanceId: 'instance-1',
  installationId: 'guild-1',
  guildId: 'guild-1',
  channelId: 'agent-1',
  threadId: 'thread-1',
  principalId: 'user-1',
  adapter: 'discord-agent',
  projectId: 'ff-project-1',
  runId: 'run-1',
  action: 'approve',
};

function request(body: string, authorization?: string): Request {
  return new Request(`https://broker.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body,
  });
}

function handler(overrides: {
  service?: ActivityRevalidationService;
  now?: () => number;
  consumeNonce?: (keyId: string, nonce: string, now: number) => boolean;
  logger?: (message: string) => void;
} = {}) {
  const service: ActivityRevalidationService = overrides.service ?? {
    revalidate: vi.fn(async input => ({
      schemaVersion: 1 as const,
      allowed: true,
      reasonCode: 'authorized' as const,
      action: input.action,
      principalId: input.principalId,
      runId: input.runId,
      revalidatedAt: 2_000,
    })),
  };
  return {
    service,
    handle: createActivityBootstrapHttpHandler({
      service: {
        startOAuth: vi.fn(),
        bootstrap: vi.fn(),
      },
      allowedOrigins: ['https://activity.example'],
      logger: overrides.logger,
      revalidation: {
        service,
        auth: {
          keys,
          nonceStore: {
            consumeNonce: overrides.consumeNonce ?? (() => true),
          },
        },
        now: overrides.now ?? (() => 2_000),
      },
    }),
  };
}

describe('Activity revalidation HTTP endpoint', () => {
  it('accepts an exact-body ff-to-agent signature without a browser Origin header', async () => {
    const body = JSON.stringify(payload);
    const auth = formatServiceAuthHeader(signServiceRequest(
      keys,
      'ff-to-agent',
      'POST',
      path,
      body,
      2_000,
      'nonce-1',
    ));
    const { handle, service } = handler();

    const response = await handle(request(body, auth));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      allowed: true,
      reasonCode: 'authorized',
      action: 'approve',
      principalId: 'user-1',
      runId: 'run-1',
      revalidatedAt: 2_000,
    });
    expect(service.revalidate).toHaveBeenCalledWith(payload);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['missing signature', undefined, 'service_auth_header_required'],
    ['wrong direction', formatServiceAuthHeader(signServiceRequest(keys, 'agent-to-ff', 'POST', path, JSON.stringify(payload), 2_000, 'nonce-2')), 'service_auth_unknown_key'],
    ['tampered body', formatServiceAuthHeader(signServiceRequest(keys, 'ff-to-agent', 'POST', path, JSON.stringify(payload), 2_000, 'nonce-3')), 'service_auth_signature_mismatch'],
  ])('rejects %s before parsing or revalidation', async (_label, authorization, code) => {
    const signedBody = JSON.stringify(payload);
    const body = code === 'service_auth_signature_mismatch'
      ? `${signedBody} `
      : signedBody;
    const { handle, service } = handler();

    const response = await handle(request(body, authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(service.revalidate).not.toHaveBeenCalled();
  });

  it('accepts the previous reverse-direction key during rotation', async () => {
    const body = JSON.stringify(payload);
    const previousKeys = { ...keys, factoryToAgentKey: keys.previousFactoryToAgentKey! };
    const auth = formatServiceAuthHeader(signServiceRequest(
      previousKeys,
      'ff-to-agent',
      'POST',
      path,
      body,
      2_000,
      'nonce-previous',
    ));
    const { handle } = handler();

    expect((await handle(request(body, auth))).status).toBe(200);
  });

  it('rejects replayed nonces with a stable authentication error', async () => {
    const body = JSON.stringify(payload);
    const auth = formatServiceAuthHeader(signServiceRequest(
      keys,
      'ff-to-agent',
      'POST',
      path,
      body,
      2_000,
      'replayed-nonce',
    ));
    const { handle } = handler({ consumeNonce: () => false });

    const response = await handle(request(body, auth));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'service_auth_nonce_replayed' },
    });
  });

  it('checks skew against the broker clock', async () => {
    const body = JSON.stringify(payload);
    const auth = formatServiceAuthHeader(signServiceRequest(
      keys,
      'ff-to-agent',
      'POST',
      path,
      body,
      1,
      'old-nonce',
    ));
    const { handle } = handler({ now: () => 60_000 });

    const response = await handle(request(body, auth));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'service_auth_timestamp_skew' },
    });
  });

  it('returns bounded JSON errors and never logs signed body or credentials', async () => {
    const logger = vi.fn();
    const body = JSON.stringify({ ...payload, secret: 'must-not-leak' });
    const auth = formatServiceAuthHeader(signServiceRequest(
      keys,
      'ff-to-agent',
      'POST',
      path,
      body,
      2_000,
      'nonce-error',
    ));
    const { handle } = handler({
      logger,
      service: {
        revalidate: vi.fn(async () => { throw new Error('must-not-leak'); }),
      },
    });

    const response = await handle(request(body, auth));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: 'internal_error' } });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('must-not-leak');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('signature=');
  });
});

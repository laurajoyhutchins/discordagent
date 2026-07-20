import { describe, expect, it, vi } from 'vitest';
import {
  ActivityBootstrapError,
  type ActivityBootstrapService,
} from './activityBootstrapService.js';
import { createActivityBootstrapHttpHandler } from './activityBootstrapHttp.js';

function service() {
  return {
    startOAuth: vi.fn(async () => ({
      state: 'state-1',
      clientId: 'application-1',
      scopes: ['identify'],
      codeChallengeMethod: 'S256' as const,
      expiresAt: 62_000,
    })),
    bootstrap: vi.fn(async () => ({
      discord: {
        accessToken: 'access-1',
        tokenType: 'Bearer' as const,
        expiresIn: 3600,
        scope: 'identify',
      },
      factoryFloor: {
        instanceBindingId: 'binding-1',
        sessionToken: 'session-1',
        expiresAt: '2026-07-20T01:00:00.000Z',
        idleExpiresAt: '2026-07-20T00:40:00.000Z',
      },
      context: { kind: 'run' as const, projectId: 'project-1', runId: 'run-1' },
    })),
  } satisfies ActivityBootstrapService;
}

function post(path: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://broker.example${path}`, {
    method: 'POST',
    headers: {
      origin: 'https://123.discordsays.com',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  });
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe('Activity bootstrap HTTP policy', () => {
  it('routes OAuth start with exact CORS and no-store headers', async () => {
    const bootstrap = service();
    const handle = createActivityBootstrapHttpHandler({
      service: bootstrap,
      allowedOrigins: ['https://123.discordsays.com'],
      maxBodyBytes: 8_192,
    });
    const response = await handle(post(
      '/api/v1/discord/activity/oauth/start',
      { instanceId: 'instance-1', codeChallenge: 'challenge-1' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin'))
      .toBe('https://123.discordsays.com');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(bootstrap.startOAuth).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      codeChallenge: 'challenge-1',
    });
  });

  it('passes only the bounded bootstrap fields to the service', async () => {
    const bootstrap = service();
    const handle = createActivityBootstrapHttpHandler({
      service: bootstrap,
      allowedOrigins: ['https://123.discordsays.com'],
    });
    const response = await handle(post('/api/v1/discord/activity/bootstrap', {
      state: 'state-1',
      instanceId: 'instance-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
      projectId: 'ignored-project',
      runId: 'ignored-run',
    }));

    expect(response.status).toBe(200);
    expect(bootstrap.bootstrap).toHaveBeenCalledWith({
      state: 'state-1',
      instanceId: 'instance-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
    });
  });

  it('answers exact-origin preflight without invoking the service', async () => {
    const bootstrap = service();
    const handle = createActivityBootstrapHttpHandler({
      service: bootstrap,
      allowedOrigins: ['https://123.discordsays.com'],
    });
    const response = await handle(new Request(
      'https://broker.example/api/v1/discord/activity/bootstrap',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://123.discordsays.com',
          'access-control-request-method': 'POST',
        },
      },
    ));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(bootstrap.startOAuth).not.toHaveBeenCalled();
  });

  it.each([
    ['origin', post('/api/v1/discord/activity/oauth/start', {}, {
      headers: { origin: 'https://other.example', 'content-type': 'application/json' },
    }), 403, 'origin_not_allowed'],
    ['method', post('/api/v1/discord/activity/oauth/start', {}, {
      method: 'GET', body: undefined,
    }), 405, 'method_not_allowed'],
    ['content type', post('/api/v1/discord/activity/oauth/start', {}, {
      headers: { origin: 'https://123.discordsays.com', 'content-type': 'text/plain' },
    }), 415, 'content_type_required'],
    ['route', post('/api/v1/discord/activity/unknown', {}), 404, 'route_not_found'],
  ])('rejects invalid %s', async (_label, input, status, code) => {
    const response = await createActivityBootstrapHttpHandler({
      service: service(),
      allowedOrigins: ['https://123.discordsays.com'],
    })(input);
    expect(response.status).toBe(status);
    expect(await body(response)).toEqual({ error: { code } });
  });

  it('rejects oversized JSON before service invocation', async () => {
    const bootstrap = service();
    const response = await createActivityBootstrapHttpHandler({
      service: bootstrap,
      allowedOrigins: ['https://123.discordsays.com'],
      maxBodyBytes: 32,
    })(post('/api/v1/discord/activity/oauth/start', {
      instanceId: 'x'.repeat(64), codeChallenge: 'challenge',
    }));

    expect(response.status).toBe(413);
    expect(await body(response)).toEqual({ error: { code: 'body_too_large' } });
    expect(bootstrap.startOAuth).not.toHaveBeenCalled();
  });

  it('maps service failures to stable redacted errors', async () => {
    const bootstrap = service();
    bootstrap.bootstrap.mockRejectedValueOnce(
      new ActivityBootstrapError('forbidden', 'oauth_principal_mismatch'),
    );
    const response = await createActivityBootstrapHttpHandler({
      service: bootstrap,
      allowedOrigins: ['https://123.discordsays.com'],
    })(post('/api/v1/discord/activity/bootstrap', {
      state: 'state-1', instanceId: 'instance-1', code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
    }));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      error: { code: 'oauth_principal_mismatch' },
    });
  });
});
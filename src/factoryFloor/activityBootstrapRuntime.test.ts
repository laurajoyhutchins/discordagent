import { describe, expect, it, vi } from 'vitest';
import type { FactoryFloorRuntimeServices } from './runtime.js';
import {
  startOptionalActivityBootstrapBroker,
  type ActivityBootstrapGuildClient,
} from './activityBootstrapRuntime.js';

const enabledEnv = {
  FACTORY_FLOOR_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN: 'https://broker.example',
  FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS: 'https://123.discordsays.com',
  FACTORY_FLOOR_BROKER_REDIRECT_URIS: 'https://123.discordsays.com/.proxy/oauth/callback',
  FACTORY_FLOOR_BROKER_TLS_CERT_PATH: '/run/secrets/broker.crt',
  FACTORY_FLOOR_BROKER_TLS_KEY_PATH: '/run/secrets/broker.key',
  DISCORD_CLIENT_SECRET: 'fixture-client-secret',
};

const runtime = {
  launchLookup: { findByInteractionId: vi.fn() },
  launches: { findByStateId: vi.fn(), consume: vi.fn() },
  oauth: { begin: vi.fn(), verifyAndConsume: vi.fn() },
  serviceClient: { createOrJoinActivitySession: vi.fn() },
} as unknown as FactoryFloorRuntimeServices;

const client: ActivityBootstrapGuildClient = {
  guilds: {
    fetch: vi.fn(async () => ({
      members: {
        fetch: vi.fn(async () => ({ id: 'user-1' } as never)),
      },
    })),
  },
};

describe('optional Activity bootstrap broker composition', () => {
  it('is a silent no-op while the broker is disabled', async () => {
    const startServer = vi.fn();

    await expect(startOptionalActivityBootstrapBroker({
      env: {},
      applicationId: 'application-1',
      botToken: 'bot-token',
      client,
      runtime,
      startServer,
    })).resolves.toBeUndefined();

    expect(startServer).not.toHaveBeenCalled();
  });

  it('composes the focused service and returns the server lifecycle', async () => {
    const handle = { dispose: vi.fn(async () => undefined) };
    const startServer = vi.fn(async () => handle);
    const activityService = {
      startOAuth: vi.fn(),
      bootstrap: vi.fn(),
    };
    const createService = vi.fn(() => activityService);
    const discord = {
      getActivityInstance: vi.fn(),
      exchangeAuthorizationCode: vi.fn(),
      getCurrentUser: vi.fn(),
    };
    const createDiscordClient = vi.fn(() => discord);

    await expect(startOptionalActivityBootstrapBroker({
      env: enabledEnv,
      applicationId: 'application-1',
      botToken: 'bot-token',
      client,
      runtime,
      startServer,
      createService,
      createDiscordClient,
    })).resolves.toBe(handle);

    expect(createDiscordClient).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-1',
      botToken: 'bot-token',
      clientSecret: 'fixture-client-secret',
      timeoutMs: 10_000,
      maxResponseBytes: 32_768,
    }));
    expect(createService).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-1',
      oauthScopes: ['identify'],
      oauthTtlMs: 60_000,
      allowedRedirectUris: ['https://123.discordsays.com/.proxy/oauth/callback'],
      launchLookup: runtime.launchLookup,
      launches: runtime.launches,
      oauth: runtime.oauth,
      factoryFloor: runtime.serviceClient,
      resolveMember: expect.any(Function),
    }));
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ publicOrigin: 'https://broker.example' }),
      handler: expect.any(Function),
    }));
  });

  it('revalidates membership through the current guild client', async () => {
    const member = { id: 'user-1' };
    const fetchMember = vi.fn(async () => member as never);
    const guildClient: ActivityBootstrapGuildClient = {
      guilds: {
        fetch: vi.fn(async () => ({ members: { fetch: fetchMember } })),
      },
    };
    let resolveMember: ((guildId: string, userId: string) => Promise<unknown>) | undefined;

    await startOptionalActivityBootstrapBroker({
      env: enabledEnv,
      applicationId: 'application-1',
      botToken: 'bot-token',
      client: guildClient,
      runtime,
      authorize: value => value === member,
      createDiscordClient: vi.fn(() => ({
        getActivityInstance: vi.fn(),
        exchangeAuthorizationCode: vi.fn(),
        getCurrentUser: vi.fn(),
      })),
      createService: vi.fn(dependencies => {
        resolveMember = dependencies.resolveMember;
        return { startOAuth: vi.fn(), bootstrap: vi.fn() };
      }),
      startServer: vi.fn(async () => ({ dispose: vi.fn(async () => undefined) })),
    });

    await expect(resolveMember?.('guild-1', 'user-1')).resolves.toEqual({
      userId: 'user-1',
      authorized: true,
    });
    expect(fetchMember).toHaveBeenCalledWith('user-1');
  });
});
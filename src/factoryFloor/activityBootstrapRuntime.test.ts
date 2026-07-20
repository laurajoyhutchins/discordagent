import { describe, expect, it, vi } from 'vitest';
import type { FactoryFloorRuntimeServices } from './runtime.js';
import {
  startOptionalActivityBootstrapBroker,
  type ActivityBootstrapGuildClient,
} from './activityBootstrapRuntime.js';
import type { ActivityRevalidationDependencies } from './activityRevalidationService.js';

const enabledEnv = {
  FACTORY_FLOOR_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN: 'https://broker.example',
  FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS: 'https://123.discordsays.com',
  FACTORY_FLOOR_BROKER_REDIRECT_URIS: 'https://123.discordsays.com/.proxy/oauth/callback',
  FACTORY_FLOOR_BROKER_TLS_CERT_PATH: '/run/secrets/broker.crt',
  FACTORY_FLOOR_BROKER_TLS_KEY_PATH: '/run/secrets/broker.key',
  DISCORD_CLIENT_SECRET: 'fixture-client-secret',
  DISCORD_GUILD_ID: 'guild-1',
};

const runtime = {
  config: {
    serviceAuthKeys: {
      agentToFactoryKey: 'agent-current',
      factoryToAgentKey: 'factory-current',
    },
  },
  bindings: { findRun: vi.fn(), findProjectByFactoryFloorId: vi.fn(), findSurfaceByActivityInstance: vi.fn() },
  activityInstances: { bind: vi.fn() },
  launchLookup: { findByInteractionId: vi.fn() },
  launches: { findByStateId: vi.fn(), consume: vi.fn() },
  oauth: { begin: vi.fn(), verifyAndConsume: vi.fn() },
  nonceStore: { consumeNonce: vi.fn(() => true) },
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

  it('composes OAuth bootstrap and service-authenticated revalidation on one server', async () => {
    const handle = { dispose: vi.fn(async () => undefined) };
    const startServer = vi.fn(async () => handle);
    const activityService = {
      startOAuth: vi.fn(),
      bootstrap: vi.fn(),
    };
    const createService = vi.fn(() => activityService);
    const revalidationService = { revalidate: vi.fn() };
    const createRevalidationService = vi.fn(() => revalidationService);
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
      createRevalidationService,
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
      factoryFloor: expect.objectContaining({ createOrJoinActivitySession: expect.any(Function) }),
      resolveMember: expect.any(Function),
    }));
    expect(createRevalidationService).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-1',
      guildId: 'guild-1',
      adapter: 'discord-agent',
      timeoutMs: 10_000,
      maxRequests: 30,
      rateLimitWindowMs: 60_000,
      discord,
      bindings: runtime.bindings,
      resolveMember: expect.any(Function),
    }));
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ publicOrigin: 'https://broker.example' }),
      handler: expect.any(Function),
    }));
  });

  it('resolves current roles for bootstrap and action-specific revalidation', async () => {
    const member = { id: 'user-1' };
    const fetchMember = vi.fn(async () => member as never);
    const guildClient: ActivityBootstrapGuildClient = {
      guilds: {
        fetch: vi.fn(async () => ({ members: { fetch: fetchMember } })),
      },
    };
    let bootstrapResolveMember: ((guildId: string, userId: string) => Promise<unknown>) | undefined;
    let revalidationDependencies: ActivityRevalidationDependencies | undefined;

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
        bootstrapResolveMember = dependencies.resolveMember;
        return { startOAuth: vi.fn(), bootstrap: vi.fn() };
      }),
      createRevalidationService: vi.fn(dependencies => {
        revalidationDependencies = dependencies;
        return { revalidate: vi.fn() };
      }),
      startServer: vi.fn(async () => ({ dispose: vi.fn(async () => undefined) })),
    });

    await expect(bootstrapResolveMember?.('guild-1', 'user-1')).resolves.toEqual({
      userId: 'user-1',
      authorized: true,
    });
    await expect(
      revalidationDependencies?.resolveMember('guild-1', 'user-1', 'approve'),
    ).resolves.toEqual({
      kind: 'member',
      userId: 'user-1',
      authorized: true,
    });
    expect(fetchMember).toHaveBeenCalledTimes(2);
  });

  it('distinguishes removed members from temporary Discord failures', async () => {
    const removedClient: ActivityBootstrapGuildClient = {
      guilds: {
        fetch: vi.fn(async () => ({
          members: {
            fetch: vi.fn(async () => Promise.reject({ code: 10_007 })) as never,
          },
        })),
      },
    };
    let revalidationDependencies: ActivityRevalidationDependencies | undefined;

    await startOptionalActivityBootstrapBroker({
      env: enabledEnv,
      applicationId: 'application-1',
      botToken: 'bot-token',
      client: removedClient,
      runtime,
      createDiscordClient: vi.fn(() => ({
        getActivityInstance: vi.fn(),
        exchangeAuthorizationCode: vi.fn(),
        getCurrentUser: vi.fn(),
      })),
      createService: vi.fn(() => ({ startOAuth: vi.fn(), bootstrap: vi.fn() })),
      createRevalidationService: vi.fn(dependencies => {
        revalidationDependencies = dependencies;
        return { revalidate: vi.fn() };
      }),
      startServer: vi.fn(async () => ({ dispose: vi.fn(async () => undefined) })),
    });

    await expect(
      revalidationDependencies?.resolveMember('guild-1', 'user-1', 'cancel'),
    ).resolves.toEqual({ kind: 'missing' });
  });
});

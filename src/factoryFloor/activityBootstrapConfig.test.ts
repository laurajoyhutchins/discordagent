import { describe, expect, it } from 'vitest';
import { activityBootstrapConfigFromEnv } from './activityBootstrapConfig.js';

const enabled = {
  FACTORY_FLOOR_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_ENABLED: 'true',
  FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN: 'https://broker.example',
  FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS: 'https://123.discordsays.com,https://456.discordsays.com',
  FACTORY_FLOOR_BROKER_REDIRECT_URIS: 'https://123.discordsays.com/.proxy/oauth/callback',
  FACTORY_FLOOR_BROKER_TLS_CERT_PATH: '/run/secrets/broker.crt',
  FACTORY_FLOOR_BROKER_TLS_KEY_PATH: '/run/secrets/broker.key',
  DISCORD_CLIENT_SECRET: 'fixture-client-secret',
};

describe('activityBootstrapConfigFromEnv', () => {
  it('is disabled independently from the Factory Floor adapter', () => {
    expect(activityBootstrapConfigFromEnv({})).toBeUndefined();
    expect(activityBootstrapConfigFromEnv({
      FACTORY_FLOOR_ENABLED: 'true',
      FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN: 'ignored',
    })).toBeUndefined();
  });

  it('normalizes explicit HTTPS deployment and bounded defaults', () => {
    expect(activityBootstrapConfigFromEnv(enabled)).toEqual({
      host: '127.0.0.1',
      port: 8443,
      publicOrigin: 'https://broker.example',
      allowedOrigins: [
        'https://123.discordsays.com',
        'https://456.discordsays.com',
      ],
      redirectUris: ['https://123.discordsays.com/.proxy/oauth/callback'],
      tlsCertPath: '/run/secrets/broker.crt',
      tlsKeyPath: '/run/secrets/broker.key',
      discordClientSecret: 'fixture-client-secret',
      oauthScopes: ['identify'],
      oauthTtlMs: 60_000,
      requestTimeoutMs: 10_000,
      maxResponseBytes: 32_768,
      maxBodyBytes: 8_192,
    });
  });

  it('accepts explicit host, port, scopes, and bounded limits', () => {
    expect(activityBootstrapConfigFromEnv({
      ...enabled,
      FACTORY_FLOOR_BROKER_HOST: '0.0.0.0',
      FACTORY_FLOOR_BROKER_PORT: '9443',
      FACTORY_FLOOR_BROKER_OAUTH_SCOPES: 'identify,guilds.members.read',
      FACTORY_FLOOR_BROKER_OAUTH_TTL_MS: '90000',
      FACTORY_FLOOR_BROKER_REQUEST_TIMEOUT_MS: '12000',
      FACTORY_FLOOR_BROKER_MAX_RESPONSE_BYTES: '16384',
      FACTORY_FLOOR_BROKER_MAX_BODY_BYTES: '4096',
    })).toEqual(expect.objectContaining({
      host: '0.0.0.0',
      port: 9443,
      oauthScopes: ['identify', 'guilds.members.read'],
      oauthTtlMs: 90_000,
      requestTimeoutMs: 12_000,
      maxResponseBytes: 16_384,
      maxBodyBytes: 4_096,
    }));
  });

  it.each([
    ['adapter disabled', { ...enabled, FACTORY_FLOOR_ENABLED: 'false' }, /requires FACTORY_FLOOR_ENABLED/i],
    ['HTTP public origin', { ...enabled, FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN: 'http://broker.example' }, /https origin/i],
    ['origin path', { ...enabled, FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS: 'https://123.discordsays.com/path' }, /origin without a path/i],
    ['redirect fragment', { ...enabled, FACTORY_FLOOR_BROKER_REDIRECT_URIS: 'https://123.discordsays.com/callback#fragment' }, /redirect URI/i],
    ['missing TLS certificate', { ...enabled, FACTORY_FLOOR_BROKER_TLS_CERT_PATH: '' }, /TLS_CERT_PATH is required/i],
    ['missing client secret', { ...enabled, DISCORD_CLIENT_SECRET: '' }, /DISCORD_CLIENT_SECRET is required/i],
    ['invalid port', { ...enabled, FACTORY_FLOOR_BROKER_PORT: '70000' }, /between 1 and 65535/i],
    ['invalid OAuth TTL', { ...enabled, FACTORY_FLOOR_BROKER_OAUTH_TTL_MS: '1000' }, /between 30000 and 600000/i],
  ])('fails deterministic validation for %s', (_label, env, expected) => {
    expect(() => activityBootstrapConfigFromEnv(env)).toThrow(expected);
  });
});
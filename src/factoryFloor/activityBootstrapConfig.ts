export interface ActivityBootstrapServerConfig {
  host: string;
  port: number;
  publicOrigin: string;
  allowedOrigins: string[];
  redirectUris: string[];
  tlsCertPath: string;
  tlsKeyPath: string;
  discordClientSecret: string;
  oauthScopes: string[];
  oauthTtlMs: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxBodyBytes: number;
}

function required(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required when the Activity broker is enabled`);
  return value;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function absoluteHttpsOrigin(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTPS origin`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be an HTTPS origin without credentials, query, or fragment`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${key} must be an origin without a path`);
  }
  return url.origin;
}

function redirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FACTORY_FLOOR_BROKER_REDIRECT_URIS must contain valid redirect URIs');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'FACTORY_FLOOR_BROKER_REDIRECT_URIS must contain HTTPS redirect URIs without credentials, query, or fragment',
    );
  }
  return url.toString();
}

function list(
  env: Record<string, string | undefined>,
  key: string,
): string[] {
  const values = required(env, key)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${key} must contain unique comma-separated values`);
  }
  return values;
}

export function activityBootstrapConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ActivityBootstrapServerConfig | undefined {
  if (env.FACTORY_FLOOR_BROKER_ENABLED !== 'true') return undefined;
  if (env.FACTORY_FLOOR_ENABLED !== 'true') {
    throw new Error('The Activity broker requires FACTORY_FLOOR_ENABLED=true');
  }

  const allowedOrigins = list(env, 'FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS')
    .map(value => absoluteHttpsOrigin(value, 'FACTORY_FLOOR_BROKER_ALLOWED_ORIGINS'));
  const redirectUris = list(env, 'FACTORY_FLOOR_BROKER_REDIRECT_URIS')
    .map(redirectUri);
  const scopes = (env.FACTORY_FLOOR_BROKER_OAUTH_SCOPES ?? 'identify')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    throw new Error('FACTORY_FLOOR_BROKER_OAUTH_SCOPES must contain unique scopes');
  }

  return {
    host: env.FACTORY_FLOOR_BROKER_HOST?.trim() || '127.0.0.1',
    port: boundedInteger(
      env.FACTORY_FLOOR_BROKER_PORT,
      8443,
      'FACTORY_FLOOR_BROKER_PORT',
      1,
      65_535,
    ),
    publicOrigin: absoluteHttpsOrigin(
      required(env, 'FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN'),
      'FACTORY_FLOOR_BROKER_PUBLIC_ORIGIN',
    ),
    allowedOrigins,
    redirectUris,
    tlsCertPath: required(env, 'FACTORY_FLOOR_BROKER_TLS_CERT_PATH'),
    tlsKeyPath: required(env, 'FACTORY_FLOOR_BROKER_TLS_KEY_PATH'),
    discordClientSecret: required(env, 'DISCORD_CLIENT_SECRET'),
    oauthScopes: scopes,
    oauthTtlMs: boundedInteger(
      env.FACTORY_FLOOR_BROKER_OAUTH_TTL_MS,
      60_000,
      'FACTORY_FLOOR_BROKER_OAUTH_TTL_MS',
      30_000,
      600_000,
    ),
    requestTimeoutMs: boundedInteger(
      env.FACTORY_FLOOR_BROKER_REQUEST_TIMEOUT_MS,
      10_000,
      'FACTORY_FLOOR_BROKER_REQUEST_TIMEOUT_MS',
      1,
      60_000,
    ),
    maxResponseBytes: boundedInteger(
      env.FACTORY_FLOOR_BROKER_MAX_RESPONSE_BYTES,
      32_768,
      'FACTORY_FLOOR_BROKER_MAX_RESPONSE_BYTES',
      1_024,
      1_048_576,
    ),
    maxBodyBytes: boundedInteger(
      env.FACTORY_FLOOR_BROKER_MAX_BODY_BYTES,
      8_192,
      'FACTORY_FLOOR_BROKER_MAX_BODY_BYTES',
      1_024,
      65_536,
    ),
  };
}

export type DiscordActivityApiErrorKind =
  | 'configuration'
  | 'timeout'
  | 'unavailable'
  | 'unauthorized'
  | 'not_found'
  | 'remote'
  | 'malformed_response';

export class DiscordActivityApiError extends Error {
  constructor(
    public readonly kind: DiscordActivityApiErrorKind,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(`Discord Activity API request failed: ${code}`);
    this.name = 'DiscordActivityApiError';
  }
}

export interface DiscordOAuthToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

export interface DiscordCurrentUser { id: string }

export interface DiscordActivityInstance {
  applicationId: string;
  instanceId: string;
  launchId: string;
  location: {
    id: string;
    kind: 'gc';
    guildId: string;
    channelId: string;
  };
  users: string[];
}

export interface DiscordActivityApiClientOptions {
  applicationId: string;
  clientSecret: string;
  botToken: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface DiscordAuthorizationCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

const API_BASE = 'https://discord.com/api/v10/';

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new DiscordActivityApiError('configuration', `${field}_required`);
  return normalized;
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DiscordActivityApiError('configuration', `${field}_invalid`);
  }
  return value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class DiscordActivityApiClient {
  private readonly applicationId: string;
  private readonly clientSecret: string;
  private readonly botToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: DiscordActivityApiClientOptions) {
    this.applicationId = required(options.applicationId, 'discord_application_id');
    this.clientSecret = required(options.clientSecret, 'discord_client_secret');
    this.botToken = required(options.botToken, 'discord_bot_token');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = positive(options.timeoutMs ?? 10_000, 'discord_api_timeout');
    this.maxResponseBytes = positive(
      options.maxResponseBytes ?? 32 * 1024,
      'discord_api_response_limit',
    );
  }

  async exchangeAuthorizationCode(input: DiscordAuthorizationCodeInput): Promise<DiscordOAuthToken> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: required(input.code, 'discord_authorization_code'),
      code_verifier: required(input.codeVerifier, 'discord_code_verifier'),
      redirect_uri: required(input.redirectUri, 'discord_redirect_uri'),
    });
    const value = await this.request('oauth2/token', {
      method: 'POST',
      body: form.toString(),
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.applicationId}:${this.clientSecret}`,
          'utf8',
        ).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
    }, 'discord_oauth_endpoint_not_found');
    const parsed = object(value);
    if (
      typeof parsed?.access_token !== 'string'
      || parsed.token_type !== 'Bearer'
      || !Number.isSafeInteger(parsed.expires_in)
      || Number(parsed.expires_in) <= 0
      || typeof parsed.scope !== 'string'
    ) {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_oauth_response_invalid',
      );
    }
    return {
      accessToken: parsed.access_token,
      tokenType: 'Bearer',
      expiresIn: Number(parsed.expires_in),
      scope: parsed.scope,
    };
  }

  async getCurrentUser(accessToken: string): Promise<DiscordCurrentUser> {
    const value = await this.request('users/@me', {
      headers: {
        authorization: `Bearer ${required(accessToken, 'discord_access_token')}`,
        accept: 'application/json',
      },
    }, 'discord_current_user_not_found');
    const id = object(value)?.id;
    if (typeof id !== 'string' || !id) {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_current_user_response_invalid',
      );
    }
    return { id };
  }

  async getActivityInstance(instanceId: string): Promise<DiscordActivityInstance> {
    const normalized = required(instanceId, 'discord_activity_instance_id');
    const value = await this.request(
      `applications/${encodeURIComponent(this.applicationId)}/activity-instances/${encodeURIComponent(normalized)}`,
      {
        headers: { authorization: `Bot ${this.botToken}`, accept: 'application/json' },
      },
      'discord_activity_instance_not_found',
    );
    const parsed = object(value);
    const location = object(parsed?.location);
    const users = parsed?.users;
    if (
      parsed?.application_id !== this.applicationId
      || parsed.instance_id !== normalized
      || typeof parsed.launch_id !== 'string'
      || !parsed.launch_id
      || typeof location?.id !== 'string'
      || location.kind !== 'gc'
      || typeof location.guild_id !== 'string'
      || typeof location.channel_id !== 'string'
      || !Array.isArray(users)
      || !users.every(user => typeof user === 'string' && user.length > 0)
    ) {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_activity_instance_response_invalid',
      );
    }
    return {
      applicationId: this.applicationId,
      instanceId: normalized,
      launchId: parsed.launch_id,
      location: {
        id: location.id,
        kind: 'gc',
        guildId: location.guild_id,
        channelId: location.channel_id,
      },
      users: [...users] as string[],
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    notFoundCode: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(new URL(path, API_BASE), {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new DiscordActivityApiError(
        timeout ? 'timeout' : 'unavailable',
        timeout ? 'discord_api_timeout' : 'discord_api_unavailable',
      );
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_response_too_large',
        response.status,
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new DiscordActivityApiError(
        'unavailable',
        'discord_response_unreadable',
        response.status,
      );
    }
    if (Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_response_too_large',
        response.status,
      );
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new DiscordActivityApiError('unauthorized', 'discord_api_unauthorized', response.status);
      }
      if (response.status === 404) {
        throw new DiscordActivityApiError('not_found', notFoundCode, response.status);
      }
      throw new DiscordActivityApiError('remote', `discord_api_http_${response.status}`, response.status);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DiscordActivityApiError(
        'malformed_response',
        'discord_response_invalid_json',
        response.status,
      );
    }
  }
}

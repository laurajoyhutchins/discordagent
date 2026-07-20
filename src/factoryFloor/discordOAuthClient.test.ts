import { describe, expect, it, vi } from 'vitest';
import {
  DiscordActivityApiClient,
  DiscordActivityApiError,
} from './discordOAuthClient.js';

function client(fetchFn: typeof fetch) {
  return new DiscordActivityApiClient({
    applicationId: 'application-1',
    clientSecret: 'client-secret',
    botToken: 'bot-token',
    fetchFn,
    timeoutMs: 5_000,
    maxResponseBytes: 1_024,
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('DiscordActivityApiClient', () => {
  it('exchanges an authorization code with server credentials and PKCE', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Basic ${Buffer.from('application-1:client-secret').toString('base64')}`,
      );
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/x-www-form-urlencoded',
      );
      const form = new URLSearchParams(String(init?.body));
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'authorization_code',
        code: 'authorization-code',
        code_verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc',
        redirect_uri: 'https://123.discordsays.com/.proxy/oauth/callback',
      });
      return json({
        access_token: 'discord-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify',
        refresh_token: 'must-not-be-returned',
      });
    });

    await expect(client(fetchFn).exchangeAuthorizationCode({
      code: 'authorization-code',
      codeVerifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc',
      redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
    })).resolves.toEqual({
      accessToken: 'discord-access-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'identify',
    });
  });

  it('confirms the current OAuth user without retaining excess profile data', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer discord-access-token',
      );
      return json({ id: 'user-1', username: 'private-profile-data' });
    });

    await expect(client(fetchFn).getCurrentUser('discord-access-token'))
      .resolves.toEqual({ id: 'user-1' });
  });

  it('validates a live Activity instance through the bot-authenticated endpoint', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        'https://discord.com/api/v10/applications/application-1/activity-instances/i-launch-1-gc-guild-1-agent-1',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe('Bot bot-token');
      return json({
        application_id: 'application-1',
        instance_id: 'i-launch-1-gc-guild-1-agent-1',
        launch_id: 'launch-1',
        location: {
          id: 'gc-guild-1-agent-1',
          kind: 'gc',
          guild_id: 'guild-1',
          channel_id: 'agent-1',
        },
        users: ['user-1'],
      });
    });

    await expect(client(fetchFn).getActivityInstance(
      'i-launch-1-gc-guild-1-agent-1',
    )).resolves.toEqual({
      applicationId: 'application-1',
      instanceId: 'i-launch-1-gc-guild-1-agent-1',
      launchId: 'launch-1',
      location: {
        id: 'gc-guild-1-agent-1',
        kind: 'gc',
        guildId: 'guild-1',
        channelId: 'agent-1',
      },
      users: ['user-1'],
    });
  });

  it.each([
    ['malformed token', async () => json({ access_token: 12, token_type: 'Bearer' }), 'discord_oauth_response_invalid'],
    ['missing instance', async () => json({ message: 'not found' }, { status: 404 }), 'discord_activity_instance_not_found'],
    ['oversized response', async () => new Response('x'.repeat(2_000), { status: 200 }), 'discord_response_too_large'],
    ['unreadable response', async () => { throw new Error('network contains secret'); }, 'discord_api_unavailable'],
  ])('maps %s to a stable redacted error', async (_label, response, code) => {
    const fetchFn = vi.fn<typeof fetch>(response as typeof fetch);
    const activityClient = client(fetchFn);

    const operation = code === 'discord_oauth_response_invalid'
      ? activityClient.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc',
        redirectUri: 'https://123.discordsays.com/.proxy/oauth/callback',
      })
      : activityClient.getActivityInstance('i-launch-1-gc-guild-1-agent-1');

    await expect(operation).rejects.toEqual(
      expect.objectContaining<Partial<DiscordActivityApiError>>({
        name: 'DiscordActivityApiError',
        code,
      }),
    );
    await operation.catch(error => {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('not found');
    });
  });
});

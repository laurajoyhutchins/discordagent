import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleCodexAuth, handleCodexAuthButton } from './codexAuth.js';
import { panelIdentityRegistry } from '../discord/panelIdentity.js';

function authMessage(customId: string) {
  const message = {
    id: 'codex-auth-panel',
    channelId: 'auth-channel',
    author: { id: 'bot-1', bot: true },
    components: [{ type: 1, components: [{ type: 2, custom_id: customId }] }],
  };
  panelIdentityRegistry.register({ kind: 'codex-auth', userId: 'owner', channelId: 'auth-channel' }, message, message.components);
  return message;
}

describe('codex auth command', () => {
  it('is owner-only', async () => {
    const reply = vi.fn();
    await handleCodexAuth({ user: { id: 'other' }, options: { getSubcommand: () => 'status' }, reply } as never, { authorizedUserId: 'owner', auth: {} as never });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Only') }));
  });
  it('shows device-code guidance privately', async () => {
    const reply = vi.fn();
    const auth = { readAccount: vi.fn(async () => ({ authenticated: false })), startDeviceLogin: vi.fn(async () => ({ loginId: 'l', verificationUrl: 'https://example.test', userCode: 'ABCD' })) };
    await handleCodexAuth({ user: { id: 'owner' }, options: { getSubcommand: () => 'login' }, reply } as never, { authorizedUserId: 'owner', auth: auth as never });
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).not.toContain('ABCD');
    expect(payload.content).not.toContain('https://example.test');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('does not expose authentication exceptions, secrets, or paths', async () => {
    const reply = vi.fn();
    await handleCodexAuth({ user: { id: 'owner' }, options: { getSubcommand: () => 'status' }, reply } as never, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => { throw new Error('device auth failed at C:\\secrets\\codex.json DEVICE_CODE=auth-secret'); }) } as never,
    });

    const content = String(reply.mock.calls[0][0].content);
    expect(content).toMatch(/could not be completed|temporarily unavailable/i);
    expect(content).not.toContain('auth-secret');
    expect(content).not.toContain('C:\\secrets');
  });

  it('offers an explicit Start task action only after a fresh authenticated account read', async () => {
    const update = vi.fn(async () => undefined);
    const pending = { projectName: 'factory-floor', prompt: 'finish the worker registry' };
    const pendingTasks = { get: vi.fn(() => pending), start: vi.fn(async () => undefined), discard: vi.fn() };
    const interaction = {
      customId: 'codex_auth_check',
      channelId: 'auth-channel',
      user: { id: 'owner' },
      message: authMessage('codex_auth_check'),
      reply: vi.fn(async () => undefined),
      update,
    } as never;
    await handleCodexAuthButton(interaction, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      pendingTasks: pendingTasks as never,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/pending task/i),
      components: expect.any(Array),
    }));
  });

  it('redacts pending auth task prompts before Discord output', async () => {
    const update = vi.fn(async () => undefined);
    const interaction = {
      customId: 'codex_auth_check', channelId: 'auth-channel', user: { id: 'owner' }, message: authMessage('codex_auth_check'), reply: vi.fn(async () => undefined), update,
    } as never;
    await handleCodexAuthButton(interaction, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      pendingTasks: { get: vi.fn(() => ({ projectName: 'factory-floor', prompt: 'Run API_KEY=pending-secret using https://example.test/device?user_code=url-secret' })) } as never,
    });

    const content = String((update as unknown as { mock: { calls: Array<Array<{ content?: string }>> } }).mock.calls[0]?.[0]?.content);
    expect(content).not.toContain('pending-secret');
    expect(content).not.toContain('url-secret');
  });

  it('starts the held task only after rechecking authentication', async () => {
    const pendingTasks = { start: vi.fn(async () => undefined) };
    const interaction = {
      customId: 'codex_auth_start_pending',
      channelId: 'auth-channel',
      user: { id: 'owner' },
      message: authMessage('codex_auth_start_pending'),
      reply: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    } as never;
    await handleCodexAuthButton(interaction, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      pendingTasks: pendingTasks as never,
    });
    expect(pendingTasks.start).toHaveBeenCalledWith('owner');
  });

  it('rejects an auth button from a stale or malformed bot message', async () => {
    const reply = vi.fn(async () => undefined);
    const message = authMessage('codex_auth_check');
    message.id = 'stale-auth-panel';
    const interaction = {
      customId: 'codex_auth_check',
      channelId: 'auth-channel',
      user: { id: 'owner' },
      message,
      reply,
      update: vi.fn(async () => undefined),
    } as never;

    await handleCodexAuthButton(interaction, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
    });

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/stale|unexpected controls/i) }));
  });

});

import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleCodexAuth, handleCodexAuthButton } from './codexAuth.js';

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
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ABCD'), flags: MessageFlags.Ephemeral }));
  });

  it('offers an explicit Start task action only after a fresh authenticated account read', async () => {
    const update = vi.fn(async () => undefined);
    const pending = { projectName: 'factory-floor', prompt: 'finish the worker registry' };
    const pendingTasks = { get: vi.fn(() => pending), start: vi.fn(async () => undefined), discard: vi.fn() };
    const interaction = {
      customId: 'codex_auth_check',
      user: { id: 'owner' },
      message: { components: [] },
      update,
    } as never;
    await handleCodexAuthButton(interaction, {
      authorizedUserId: 'owner',
      auth: { readAccount: vi.fn(async () => ({ authenticated: true })) } as never,
      pendingTasks: pendingTasks as never,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Pending task'),
      components: expect.any(Array),
    }));
  });

  it('starts the held task only after rechecking authentication', async () => {
    const pendingTasks = { start: vi.fn(async () => undefined) };
    const interaction = {
      customId: 'codex_auth_start_pending',
      user: { id: 'owner' },
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

});

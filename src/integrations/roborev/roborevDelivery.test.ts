import { describe, expect, it, vi } from 'vitest';
import {
  PermissionFlagsBits,
  PermissionsBitField,
  type MessageCreateOptions,
  type TextChannel,
} from 'discord.js';
import type { ReviewNotification } from '../reviewSource.js';
import { deliverRoborevNotification } from './roborevDelivery.js';

const notification: ReviewNotification = {
  source: 'roborev',
  projectId: 'factory-floor',
  revision: 'abcdef1234567890',
  status: 'warning',
  summary: 'Review abcdef12 — B',
  details: {
    verdict: 'B',
    agent: 'reviewer',
    jobId: 42,
    body: 'Minor formatting issues found.',
    timestamp: '2026-07-18T12:00:00Z',
  },
};

function channel(
  permissions: readonly bigint[],
  send: (payload: MessageCreateOptions) => Promise<unknown>,
): TextChannel {
  const member = { permissions: new PermissionsBitField(permissions) };
  return {
    id: 'roborev-channel-1',
    guild: { members: { me: member } },
    parent: null,
    permissionsFor: () => new PermissionsBitField(permissions),
    send,
  } as unknown as TextChannel;
}

describe('deliverRoborevNotification', () => {
  it('delivers bounded text proactively when Embed Links is unavailable', async () => {
    const send = vi.fn(async (_payload: MessageCreateOptions) => ({ id: 'message-1' }));

    const result = await deliverRoborevNotification(
      channel([PermissionFlagsBits.SendMessages], send),
      notification,
    );

    expect(result).toEqual({ delivered: true, mode: 'text' });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/Review: abcdef12.*Minor Issues.*Minor formatting issues found/s),
    }));
    const payload = send.mock.calls[0]![0];
    expect(payload.content).toBeDefined();
    expect(payload.content!.length).toBeLessThanOrEqual(2_000);
  });

  it('retries as text after an embed send is rejected', async () => {
    const logger = vi.fn();
    const send = vi.fn(async (_payload: MessageCreateOptions) => ({ id: 'message-1' }));
    send.mockRejectedValueOnce(new Error('Missing Permissions: Embed Links'));

    const result = await deliverRoborevNotification(
      channel([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], send),
      notification,
      { logger },
    );

    expect(result).toEqual({ delivered: true, mode: 'text' });
    expect(send.mock.calls[0]![0]).toEqual(expect.objectContaining({ embeds: expect.any(Array) }));
    expect(send.mock.calls[1]![0]).toEqual(expect.objectContaining({ content: expect.any(String) }));
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/embed send failed/i));
  });

  it('isolates and reports a true send failure without claiming delivery', async () => {
    const logger = vi.fn();
    const send = vi.fn(async (_payload: MessageCreateOptions) => {
      throw new Error('Cannot send messages');
    });

    const result = await deliverRoborevNotification(
      channel([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], send),
      notification,
      { logger },
    );

    expect(result).toEqual({ delivered: false, mode: 'none' });
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/plain-text fallback failed/i));
  });
});

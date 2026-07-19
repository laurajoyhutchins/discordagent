import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import type { CapabilityEvaluationContext } from './capabilities/evaluator.js';
import { deliverPresentation } from './presentationDelivery.js';

interface Payload {
  content?: string;
  embeds?: string[];
  components?: string[];
}

function context(permissions: readonly bigint[]): CapabilityEvaluationContext {
  const member = { permissions: new PermissionsBitField(permissions) };
  return {
    member,
    channel: {
      id: 'channel-1',
      parent: null,
      permissionsFor: () => new PermissionsBitField(permissions),
    },
  };
}

const rich: Payload = { embeds: ['rich'], components: ['control'] };
const fallback: Payload = { content: 'plain text', components: ['control'] };

describe('deliverPresentation', () => {
  it('uses rich presentation unchanged when send and embed capabilities are available', async () => {
    const send = vi.fn(async () => ({ id: 'message-1' }));

    const result = await deliverPresentation({
      context: context([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]),
      sendCapabilityId: 'core.message.send',
      send,
      rich,
      fallback,
      label: 'test update',
    });

    expect(result).toEqual({ delivered: true, mode: 'rich' });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(rich);
  });

  it('uses plain text proactively when Embed Links is known unavailable', async () => {
    const send = vi.fn(async () => ({ id: 'message-1' }));

    const result = await deliverPresentation({
      context: context([PermissionFlagsBits.SendMessages]),
      sendCapabilityId: 'core.message.send',
      send,
      rich,
      fallback,
      label: 'test update',
    });

    expect(result).toEqual({ delivered: true, mode: 'text' });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(fallback);
  });

  it('falls back reactively when Discord rejects the rich payload', async () => {
    const logger = vi.fn();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Missing Permissions: Embed Links'))
      .mockResolvedValueOnce({ id: 'message-1' });

    const result = await deliverPresentation({
      context: context([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]),
      sendCapabilityId: 'core.message.send',
      send,
      rich,
      fallback,
      label: 'test update',
      logger,
    });

    expect(result).toEqual({ delivered: true, mode: 'text' });
    expect(send).toHaveBeenNthCalledWith(1, rich);
    expect(send).toHaveBeenNthCalledWith(2, fallback);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/embed send failed.*plain text/i));
  });

  it('does not attempt delivery when message sending is known unavailable', async () => {
    const logger = vi.fn();
    const send = vi.fn(async () => ({ id: 'message-1' }));

    const result = await deliverPresentation({
      context: context([]),
      sendCapabilityId: 'core.message.send',
      send,
      rich,
      fallback,
      label: 'test update',
      logger,
    });

    expect(result).toEqual({ delivered: false, mode: 'none' });
    expect(send).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/not sent.*SendMessages/i));
  });

  it('logs and returns an explicit non-delivery result when rich and text sends both fail', async () => {
    const logger = vi.fn();
    const send = vi.fn(async () => {
      throw new Error('Cannot send messages');
    });

    const result = await deliverPresentation({
      context: context([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]),
      sendCapabilityId: 'core.message.send',
      send,
      rich,
      fallback,
      label: 'test update',
      logger,
    });

    expect(result).toEqual({ delivered: false, mode: 'none' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalledWith(expect.stringMatching(/plain-text fallback failed/i));
  });
});

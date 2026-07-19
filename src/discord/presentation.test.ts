import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  formatEmptyState,
  operatorEmbed,
  operatorReplyPayload,
  sessionStateLabel,
  taskStatusLabel,
  taskStatusTone,
} from './presentation.js';

function interactionWithPermissions(bits: bigint) {
  const member = { permissions: new PermissionsBitField(bits) };
  return {
    guild: { members: { me: member, fetchMe: async () => member } },
    channel: {
      id: 'channel-1',
      permissionsFor: () => new PermissionsBitField(bits),
    },
  };
}

describe('operator presentation helpers', () => {
  it('maps durable task states to concise operator language', () => {
    expect(taskStatusLabel('created')).toBe('Queued');
    expect(taskStatusLabel('waiting_for_user')).toBe('Needs your input');
    expect(taskStatusLabel('completed')).toBe('Completed');
    expect(sessionStateLabel('not_started')).toBe('Not started');
  });

  it('uses attention and terminal tones consistently', () => {
    expect(taskStatusTone('waiting_for_user')).toBe('attention');
    expect(taskStatusTone('completed')).toBe('success');
    expect(taskStatusTone('failed')).toBe('danger');
  });

  it('formats empty states with one explicit next action', () => {
    expect(formatEmptyState({
      title: 'No projects yet',
      description: 'Nothing is registered.',
      action: 'Run `/add-project`.',
    })).toBe('**No projects yet**\nNothing is registered.\nNext: Run `/add-project`.');
  });

  it('uses readable plain text when Embed Links is unavailable', async () => {
    const embed = operatorEmbed({ title: 'Status' });

    await expect(operatorReplyPayload(
      interactionWithPermissions(PermissionFlagsBits.SendMessages) as never,
      { embed, fallback: '**Status**\nReadable fallback.' },
    )).resolves.toEqual({ content: '**Status**\nReadable fallback.' });
  });

  it('uses the rich card when Embed Links is available', async () => {
    const embed = operatorEmbed({ title: 'Status' });

    const payload = await operatorReplyPayload(
      interactionWithPermissions(PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks) as never,
      { embed, fallback: 'Fallback' },
    );

    expect(payload).toEqual({ embeds: [embed] });
  });
});

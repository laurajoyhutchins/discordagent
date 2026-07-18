import { describe, expect, it } from 'vitest';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { evaluateCapabilities, type CapabilityEvaluationContext } from './evaluator.js';

function context(overrides: Partial<CapabilityEvaluationContext> = {}): CapabilityEvaluationContext {
  const permissions = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ]);
  const member = { id: 'bot-1', permissions };
  const channel = {
    id: 'channel-1',
    permissionsFor: () => permissions,
  };
  return {
    member: member as CapabilityEvaluationContext['member'],
    channel: channel as CapabilityEvaluationContext['channel'],
    configuredIntents: ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers'],
    ...overrides,
  };
}

describe('Discord capability evaluator', () => {
  it('reports a missing core permission as required', () => {
    const report = evaluateCapabilities(['core.message.send'], context({
      channel: { id: 'channel-1', permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel]) } as CapabilityEvaluationContext['channel'],
    }));

    expect(report.evaluations[0]).toMatchObject({
      capabilityId: 'core.message.send',
      state: 'unavailable',
      required: true,
    });
  });

  it('reports an optional permission with its graceful fallback', () => {
    const report = evaluateCapabilities(['task.control-card.pin'], context());

    expect(report.evaluations[0]).toMatchObject({
      capabilityId: 'task.control-card.pin',
      state: 'unavailable',
      required: false,
      fallback: expect.stringMatching(/not pinned/i),
    });
  });

  it('uses channel effective permissions instead of guild permissions', () => {
    const report = evaluateCapabilities(['core.message.embed'], context({
      channel: { id: 'channel-1', permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel]) } as CapabilityEvaluationContext['channel'],
    }));

    expect(report.evaluations[0].state).toBe('unavailable');
  });

  it('evaluates task-thread permissions on the thread and falls back to its parent', () => {
    const parent = {
      id: 'parent-1',
      permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel]),
    };
    const thread = {
      id: 'thread-1',
      parent,
      permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.SendMessagesInThreads]),
    };

    const report = evaluateCapabilities(['task.thread.send'], context({ channel: thread as CapabilityEvaluationContext['channel'] }));
    expect(report.evaluations[0].state).toBe('available');
  });

  it('does not throw when the bot member cannot be determined', () => {
    const report = evaluateCapabilities(['core.channel.view'], context({ member: null }));

    expect(report.evaluations[0]).toMatchObject({
      state: 'cannot_determine',
      reason: expect.stringMatching(/member/i),
    });
  });
});

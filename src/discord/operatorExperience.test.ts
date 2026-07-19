import { describe, expect, it } from 'vitest';
import type { TaskControlCardView } from './taskControlCard.js';
import { renderTaskControlCard } from './taskControlCard.js';
import { commands } from '../commands/definitions.js';

const runningTask: TaskControlCardView = {
  taskId: 'task-1',
  objective: 'Polish the operator experience',
  projectName: 'discord-agent',
  provider: 'codex',
  status: 'running',
  sessionState: 'active',
};

describe('calm operator experience', () => {
  it('registers contextual help as a first-class Discord command', () => {
    const help = commands.map(command => command.toJSON()).find(command => command.name === 'help');

    expect(help).toBeDefined();
    if (!help || !('description' in help)) throw new Error('Expected /help to be a slash command');
    expect(help.description).toMatch(/context|here|guidance/i);
  });

  it('renders human-facing task and provider labels in the rich control card', () => {
    const payload = renderTaskControlCard(runningTask, { embeds: true });
    const serialized = JSON.stringify(payload.embeds?.[0].toJSON());

    expect(serialized).toContain('Task · Running');
    expect(serialized).toContain('Codex');
    expect(serialized).toContain('Active');
    expect(serialized).not.toContain('waiting_for_user');
  });
});

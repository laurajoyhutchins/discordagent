import { describe, expect, it } from 'vitest';
import { buildHelpEmbed } from './help.js';

describe('contextual help presentation', () => {
  it('guides the primary channel toward natural PM conversation', () => {
    const embed = buildHelpEmbed({ context: 'primary' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toMatch(/primary operator channel/i);
    expect(serialized).toContain('/settings');
    expect(serialized).toMatch(/blockers|expensive/i);
  });

  it('guides a project channel toward one concrete durable task', () => {
    const embed = buildHelpEmbed({ context: 'project', projectName: 'factory-floor' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toContain('factory-floor');
    expect(serialized).toMatch(/isolated durable task/i);
    expect(serialized).toContain('/project-settings');
  });

  it('guides a task thread without implying provider-session mutation', () => {
    const embed = buildHelpEmbed({ context: 'task', projectName: 'discord-agent' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toMatch(/reply here to continue/i);
    expect(serialized).toContain('Inspect');
    expect(serialized).toMatch(/sibling handoff/i);
  });
});

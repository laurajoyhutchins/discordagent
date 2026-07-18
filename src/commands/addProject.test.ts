import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';

process.env.DISCORD_TOKEN = 'test';
process.env.DISCORD_CLIENT_ID = 'test';
process.env.DISCORD_GUILD_ID = 'test';
process.env.AUTHORIZED_ROLE_IDS = 'role';
const { isPathWithinBase } = await import('./addProject.js');

describe('project path containment', () => {
  it('rejects Windows sibling prefixes while allowing the base and descendants', () => {
    const pathApi = { relative: win32.relative, isAbsolute: win32.isAbsolute, sep: win32.sep };
    expect(isPathWithinBase('C:\\Projects\\agent', 'C:\\Projects\\agent', pathApi)).toBe(true);
    expect(isPathWithinBase('C:\\Projects\\agent', 'C:\\Projects\\agent\\repo', pathApi)).toBe(true);
    expect(isPathWithinBase('C:\\Projects\\agent', 'C:\\Projects\\agent-other', pathApi)).toBe(false);
  });
});

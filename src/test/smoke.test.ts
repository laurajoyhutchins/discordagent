import { describe, expect, it } from 'vitest';
import { commands } from '../commands/definitions.js';

describe('command registration', () => {
  it('exports at least one Discord command', () => {
    expect(commands.length).toBeGreaterThan(0);
  });
});

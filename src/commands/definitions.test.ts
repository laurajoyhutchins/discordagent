import { describe, expect, it } from 'vitest';
import { commands } from './definitions.js';

describe('slash command definitions', () => {
  it('offers OpenCode in provider command choices', () => {
    const provider = commands.find(command => command.name === 'provider');
    const serialized = provider?.toJSON();
    const option = serialized && 'options' in serialized
      ? serialized.options?.find(candidate => candidate.name === 'provider')
      : undefined;

    expect(option && 'choices' in option ? option.choices : undefined).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'OpenCode', value: 'opencode' }),
    ]));
  });
});

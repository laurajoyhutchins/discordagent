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

  it('does not expose Claude-only model choices globally', () => {
    const model = commands.find(command => command.name === 'model');
    const serialized = model?.toJSON();
    const option = serialized && 'options' in serialized
      ? serialized.options?.find(candidate => candidate.name === 'model')
      : undefined;

    expect(option && 'choices' in option ? option.choices : undefined).toBeUndefined();
  });
});

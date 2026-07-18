import { describe, expect, it } from 'vitest';
import { commands } from './definitions.js';

describe('/capabilities command', () => {
  it('is registered as an authorized diagnostic slash command', () => {
    const command = commands.find(item => item.name === 'capabilities')?.toJSON();
    const description = command && 'description' in command ? command.description : undefined;
    expect(description).toMatch(/permission|capabilit/i);
    expect(command).toMatchObject({ name: 'capabilities' });
  });

  it('does not advertise cross-provider model choices in the static slash schema', () => {
    const model = commands.find(item => item.name === 'model')?.toJSON();
    const modelOption = model?.options?.find(option => option.name === 'model') as { choices?: unknown[] } | undefined;
    expect(modelOption?.choices ?? []).toEqual([]);
  });
});
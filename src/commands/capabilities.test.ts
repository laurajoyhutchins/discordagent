import { describe, expect, it } from 'vitest';
import { commands } from './definitions.js';

describe('/capabilities command', () => {
  it('is registered as an authorized diagnostic slash command', () => {
    const command = commands.find(item => item.name === 'capabilities');
    expect(command?.description).toMatch(/permission|capabilit/i);
    expect(command?.toJSON()).toMatchObject({ name: 'capabilities' });
  });

  it('does not advertise cross-provider model choices in the static slash schema', () => {
    const model = commands.find(item => item.name === 'model')?.toJSON();
    const modelOption = model?.options?.find(option => option.name === 'model') as { choices?: unknown[] } | undefined;
    expect(modelOption?.choices ?? []).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { RuntimeLifecycle } from './runtimeLifecycle.js';

describe('RuntimeLifecycle', () => {
  it('stops owners once in reverse acquisition order', async () => {
    const order: string[] = [];
    const lifecycle = new RuntimeLifecycle();
    lifecycle.defer('project store', () => { order.push('project store'); });
    lifecycle.defer('providers', async () => { order.push('providers'); });
    lifecycle.defer('usage monitoring', () => { order.push('usage monitoring'); });

    await lifecycle.stop();
    await lifecycle.stop();

    expect(order).toEqual(['usage monitoring', 'providers', 'project store']);
  });

  it('continues teardown after a cleanup failure and reports its owner', async () => {
    const order: string[] = [];
    const onError = vi.fn();
    const lifecycle = new RuntimeLifecycle({ onError });
    const failure = new Error('provider close failed');
    lifecycle.defer('project store', () => { order.push('project store'); });
    lifecycle.defer('providers', () => {
      order.push('providers');
      throw failure;
    });
    lifecycle.defer('usage monitoring', () => { order.push('usage monitoring'); });

    await lifecycle.stop();

    expect(order).toEqual(['usage monitoring', 'providers', 'project store']);
    expect(onError).toHaveBeenCalledWith({ owner: 'providers', error: failure });
  });

  it('rejects new owners after teardown starts', async () => {
    const lifecycle = new RuntimeLifecycle();
    lifecycle.defer('project store', () => undefined);

    const stopping = lifecycle.stop();

    expect(() => lifecycle.defer('late owner', () => undefined)).toThrow(/after teardown has started/i);
    await stopping;
  });
});

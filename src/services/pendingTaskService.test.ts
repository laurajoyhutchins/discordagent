import { describe, expect, it, vi } from 'vitest';
import { createPendingTaskService } from './pendingTaskService.js';

describe('PendingTaskService', () => {
  it('holds a deferred Codex request without starting it and starts only on explicit action', async () => {
    const startFromMessage = vi.fn(async () => ({}));
    const service = createPendingTaskService({ startFromMessage } as never);
    const message = { id: 'message-1' } as never;
    service.defer({ userId: 'owner', projectName: 'factory-floor', prompt: 'finish the worker registry', message, model: 'gpt-5.4' });
    expect(startFromMessage).not.toHaveBeenCalled();
    expect(service.get('owner')).toMatchObject({ projectName: 'factory-floor', prompt: 'finish the worker registry' });
    await service.start('owner');
    expect(startFromMessage).toHaveBeenCalledWith({ projectName: 'factory-floor', prompt: 'finish the worker registry', message, provider: 'codex', model: 'gpt-5.4' });
    expect(service.get('owner')).toBeUndefined();
  });

  it('retains the pending request when task startup fails', async () => {
    const service = createPendingTaskService({ startFromMessage: vi.fn(async () => { throw new Error('still unavailable'); }) } as never);
    service.defer({ userId: 'owner', projectName: 'p', prompt: 'work', message: {} as never });
    await expect(service.start('owner')).rejects.toThrow('still unavailable');
    expect(service.get('owner')).toBeDefined();
  });

  it('expires deferred requests deterministically', () => {
    let now = 100;
    const service = createPendingTaskService({ startFromMessage: vi.fn() } as never, { ttlMs: 50, now: () => now });
    service.defer({ userId: 'owner', projectName: 'p', prompt: 'work', message: {} as never });
    expect(service.get('owner')).toBeDefined();
    now = 151;
    expect(service.get('owner')).toBeUndefined();
  });

});

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CodexAuthService } from './codexAuthService.js';

class FakeTransport extends EventEmitter {
  request = vi.fn();
}

describe('CodexAuthService', () => {
  it('uses the documented ChatGPT device-code login request', async () => {
    const transport = new FakeTransport();
    transport.request.mockResolvedValueOnce({
      type: 'chatgptDeviceCode', loginId: 'login-1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234',
    });
    const auth = new CodexAuthService(transport as never);
    await expect(auth.startDeviceLogin()).resolves.toMatchObject({ loginId: 'login-1', userCode: 'ABCD-1234' });
    expect(transport.request).toHaveBeenCalledWith('account/login/start', { type: 'chatgptDeviceCode' });
  });

  it('parses the multi-bucket rate-limit response and derives remaining percent', async () => {
    const transport = new FakeTransport();
    transport.request.mockResolvedValueOnce({
      rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200 }, secondary: null },
      rateLimitsByLimitId: {
        codex: { limitId: 'codex', limitName: null, primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200 }, secondary: null },
        codex_other: { limitId: 'codex_other', limitName: 'Hourly', primary: { usedPercent: 42, windowDurationMins: 60, resetsAt: 1730950800 }, secondary: null },
      },
    });
    const auth = new CodexAuthService(transport as never);
    await expect(auth.readRateLimits()).resolves.toEqual([
      { name: 'codex:primary', utilization: 25, remaining: 75, resetsAt: 1730947200, windowDurationMins: 15 },
      { name: 'Hourly:primary', utilization: 42, remaining: 58, resetsAt: 1730950800, windowDurationMins: 60 },
    ]);
  });

  it('falls back to the backward-compatible single-bucket rate-limit view', async () => {
    const transport = new FakeTransport();
    transport.request.mockResolvedValueOnce({ rateLimits: { limitId: 'codex', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 99 }, secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 100 } } });
    const auth = new CodexAuthService(transport as never);
    await expect(auth.readRateLimits()).resolves.toEqual([
      { name: 'codex:primary', utilization: 10, remaining: 90, resetsAt: 99, windowDurationMins: 300 },
      { name: 'codex:secondary', utilization: 20, remaining: 80, resetsAt: 100, windowDurationMins: 10080 },
    ]);
  });

  it.each([
    [{ account: { type: 'chatgpt', planType: 'plus', email: 'owner@example.com' }, requiresOpenaiAuth: true }, { authenticated: true, authenticationRequired: false, authMode: 'chatgpt', planType: 'plus', email: 'owner@example.com' }],
    [{ account: null, requiresOpenaiAuth: false }, { authenticated: true, authenticationRequired: false }],
    [{ account: null, requiresOpenaiAuth: true }, { authenticated: false, authenticationRequired: true }],
  ])('derives authoritative account state from account/read %#', async (response, expected) => {
    const transport = new FakeTransport();
    transport.request.mockResolvedValueOnce(response);
    const auth = new CodexAuthService(transport as never);
    await expect(auth.readAccount()).resolves.toEqual(expected);
    expect(transport.request).toHaveBeenCalledWith('account/read', { refreshToken: false });
  });

  it('publishes rate-limit notifications and detaches from the transport on close', async () => {
    const transport = new FakeTransport();
    const listener = vi.fn();
    const auth = new CodexAuthService(transport as never);
    auth.onRateLimitsUpdated(listener);
    transport.emit('notification', 'account/rateLimits/updated', {
      rateLimits: { limitId: 'codex', primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 101 }, secondary: null },
    });
    expect(listener).toHaveBeenCalledWith([{ name: 'codex:primary', utilization: 35, remaining: 65, resetsAt: 101, windowDurationMins: 300 }]);
    await auth.close();
    expect(transport.listenerCount('notification')).toBe(0);
  });

});

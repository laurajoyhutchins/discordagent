import { describe, expect, it, vi } from 'vitest';
import { FactoryFloorClient } from './client.js';

describe('FactoryFloorClient', () => {
  it('sends scoped operator credentials and audit identity', async () => {
    const fetchFn = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Response(JSON.stringify({ runId: 'run-1', commandId: 'run-1', disposition: 'accepted' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new FactoryFloorClient({
      baseUrl: 'http://127.0.0.1:3000',
      operatorToken: 'operator-secret',
      fetchFn: fetchFn as typeof fetch,
    });

    await client.submitTask('discord:user-1', {
      clientRequestId: 'interaction-1',
      repository: 'owner/repo',
      objective: 'Implement the bridge.',
      acceptanceCriteria: ['Tests pass.'],
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:3000/api/v1/operator/tasks');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer operator-secret');
    expect(headers.get('x-factory-floor-principal-id')).toBe('discord:user-1');
    expect(headers.get('x-factory-floor-adapter')).toBe('discord-agent');
    expect(JSON.parse(String(init?.body))).toMatchObject({ clientRequestId: 'interaction-1' });
  });

  it('preserves structured API errors', async () => {
    const client = new FactoryFloorClient({
      baseUrl: 'http://127.0.0.1:3000',
      operatorToken: 'operator-secret',
      fetchFn: (async () => new Response(JSON.stringify({
        error: { code: 'approval_not_pending', message: 'approval_not_pending' },
      }), { status: 409, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });

    await expect(client.decideApproval('discord:user-1', 'approval-1', {
      clientRequestId: 'interaction-2',
      decision: 'approve',
      reason: 'Approved.',
    })).rejects.toMatchObject({
      status: 409,
      code: 'approval_not_pending',
    });
  });

  it('fails closed when enabled without an operator token', () => {
    expect(() => new FactoryFloorClient({
      baseUrl: 'http://127.0.0.1:3000',
      operatorToken: '',
    })).toThrow('FACTORY_FLOOR_OPERATOR_TOKEN');
  });
});

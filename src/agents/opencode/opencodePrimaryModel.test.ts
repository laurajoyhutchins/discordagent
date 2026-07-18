import { describe, expect, it, vi } from 'vitest';
import type { OpenCodeAcpConnection, OpenCodeAcpHandlers } from './acpTransport.js';
import { OpenCodePrimaryModel, openCodePrimaryEnvironment } from './opencodePrimaryModel.js';

function connection(overrides: Partial<OpenCodeAcpConnection> = {}): OpenCodeAcpConnection {
  return {
    initialize: vi.fn(async () => ({ protocolVersion: 1 } as never)),
    newSession: vi.fn(async () => ({
      sessionId: 'pm-session-1',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'openai/gpt-5',
        options: [{ value: 'openai/gpt-5', name: 'GPT-5' }],
      }],
    } as never)),
    loadSession: vi.fn(),
    resumeSession: vi.fn(),
    setSessionConfigOption: vi.fn(async () => ({ configOptions: [] } as never)),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' } as never)),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('OpenCodePrimaryModel', () => {
  it('uses a one-turn ACP session, denies permissions, parses JSON, and closes', async () => {
    let handlers!: OpenCodeAcpHandlers;
    const conn = connection({
      prompt: vi.fn(async (_sessionId, _prompt) => {
        await handlers.onSessionUpdate({
          sessionId: 'pm-session-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '{"reply":"OpenCode PM ready"}' },
          },
        } as never);
        await expect(handlers.onPermission({} as never)).resolves.toEqual({
          outcome: { outcome: 'cancelled' },
        });
        return { stopReason: 'end_turn' } as never;
      }),
    });
    const model = new OpenCodePrimaryModel({
      workingDirectory: '/tmp/discordagent-pm',
      createConnection: vi.fn(async value => {
        handlers = value;
        return conn;
      }),
    });

    await expect(model.respond({ context: 'No active tasks.', message: 'Status?' })).resolves.toEqual({
      reply: 'OpenCode PM ready',
    });
    expect(conn.newSession).toHaveBeenCalledWith('/tmp/discordagent-pm');
    expect(conn.prompt).toHaveBeenCalledWith(
      'pm-session-1',
      expect.stringContaining('You are the primary project-owner agent'),
    );
    expect(conn.close).toHaveBeenCalledOnce();
  });

  it('applies an advertised PM model before prompting', async () => {
    const conn = connection();
    const model = new OpenCodePrimaryModel({
      model: 'openai/gpt-5',
      createConnection: vi.fn(async () => conn),
    });

    await model.respond({ context: '', message: 'Hello' });

    expect(conn.setSessionConfigOption).toHaveBeenCalledWith(
      'pm-session-1',
      'model',
      'openai/gpt-5',
    );
    expect(conn.close).toHaveBeenCalledOnce();
  });

  it('redacts failures and still closes the ACP connection', async () => {
    const conn = connection({
      prompt: vi.fn(async () => {
        throw new Error('Authorization: Bearer sk-project-secret-value');
      }),
    });
    const model = new OpenCodePrimaryModel({
      createConnection: vi.fn(async () => conn),
    });

    const result = await model.respond({ context: '', message: 'Hello' });

    expect(result.reply).toMatch(/could not complete the coordination turn/i);
    expect(result.reply).not.toContain('sk-project-secret-value');
    expect(conn.close).toHaveBeenCalledOnce();
  });

  it('builds an isolated deny-all OpenCode runtime configuration', () => {
    const env = openCodePrimaryEnvironment({ KEEP_ME: 'yes', OPENCODE_CONFIG_CONTENT: '{"permission":"allow"}' });

    expect(env.KEEP_ME).toBe('yes');
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual({
      permission: { '*': 'deny' },
    });
  });
});

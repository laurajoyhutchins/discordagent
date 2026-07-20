import { describe, expect, it, vi } from 'vitest';
import type { ActivityBootstrapServerConfig } from './activityBootstrapConfig.js';
import {
  startActivityBootstrapServer,
  type ActivityBootstrapHttpsServer,
} from './activityBootstrapServer.js';

const config: ActivityBootstrapServerConfig = {
  host: '127.0.0.1',
  port: 8443,
  publicOrigin: 'https://broker.example',
  allowedOrigins: ['https://123.discordsays.com'],
  redirectUris: ['https://123.discordsays.com/.proxy/oauth/callback'],
  tlsCertPath: '/run/secrets/broker.crt',
  tlsKeyPath: '/run/secrets/broker.key',
  discordClientSecret: 'fixture-client-secret',
  oauthScopes: ['identify'],
  oauthTtlMs: 60_000,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 32_768,
  maxBodyBytes: 8_192,
};

function fakeServer(): ActivityBootstrapHttpsServer & {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
} {
  let errorHandler: ((error: Error) => void) | undefined;
  return {
    once: vi.fn((event: 'error', handler: (error: Error) => void) => {
      if (event === 'error') errorHandler = handler;
      return undefined;
    }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      callback();
      return undefined;
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
      return undefined;
    }),
    emitError(error: Error) { errorHandler?.(error); },
  };
}

describe('Activity bootstrap HTTPS server lifecycle', () => {
  it('loads TLS material, starts on the configured address, and closes cleanly', async () => {
    const server = fakeServer();
    const readFile = vi.fn(async (path: string) => Buffer.from(path));
    const createServer = vi.fn(() => server);

    const handle = await startActivityBootstrapServer({
      config,
      handler: vi.fn(),
      readFile,
      createServer,
    });

    expect(readFile).toHaveBeenNthCalledWith(1, config.tlsCertPath);
    expect(readFile).toHaveBeenNthCalledWith(2, config.tlsKeyPath);
    expect(createServer).toHaveBeenCalledWith(
      {
        cert: Buffer.from(config.tlsCertPath),
        key: Buffer.from(config.tlsKeyPath),
      },
      expect.any(Function),
    );
    expect(server.listen).toHaveBeenCalledWith(8443, '127.0.0.1', expect.any(Function));

    await handle.dispose();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('fails startup without returning a partially active handle', async () => {
    const server = fakeServer();
    server.listen.mockImplementationOnce(() => {
      server.emitError(new Error('address unavailable'));
      return undefined;
    });

    await expect(startActivityBootstrapServer({
      config,
      handler: vi.fn(),
      readFile: vi.fn(async () => Buffer.from('fixture')),
      createServer: vi.fn(() => server),
    })).rejects.toThrow('address unavailable');
  });

  it('surfaces TLS file failures before creating a server', async () => {
    const createServer = vi.fn();
    await expect(startActivityBootstrapServer({
      config,
      handler: vi.fn(),
      readFile: vi.fn(async () => { throw new Error('certificate unavailable'); }),
      createServer,
    })).rejects.toThrow('certificate unavailable');
    expect(createServer).not.toHaveBeenCalled();
  });
});
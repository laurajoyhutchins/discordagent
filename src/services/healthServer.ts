import { createServer, type Server } from 'node:http';

export interface HealthDependencies {
  readonly recoveryReady: boolean;
  readonly storageReady: boolean;
  readonly discordReady: boolean;
  readonly providerReady: boolean;
}

export interface HealthSnapshot extends HealthDependencies {
  readonly live: boolean;
  readonly ready: boolean;
}

export interface HealthServerHandle {
  readonly host: string;
  readonly port: number;
  snapshot(): HealthSnapshot;
  update(next: Partial<HealthDependencies>): void;
  close(): Promise<void>;
}

export interface StartHealthServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly initial?: Partial<HealthDependencies>;
}

const DEFAULT_STATE: HealthDependencies = {
  recoveryReady: false,
  storageReady: false,
  discordReady: false,
  providerReady: false,
};

export function evaluateHealth(dependencies: HealthDependencies): HealthSnapshot {
  return {
    live: true,
    ...dependencies,
    ready:
      dependencies.recoveryReady &&
      dependencies.storageReady &&
      dependencies.discordReady &&
      dependencies.providerReady,
  };
}

export async function startHealthServer(
  options: StartHealthServerOptions = {},
): Promise<HealthServerHandle> {
  const host = options.host ?? process.env.HEALTH_HOST ?? '127.0.0.1';
  const configuredPort = options.port ?? Number(process.env.HEALTH_PORT ?? 8787);
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('Health server must bind to a loopback host.');
  }
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error('HEALTH_PORT must be an integer from 0 through 65535.');
  }

  let dependencies: HealthDependencies = { ...DEFAULT_STATE, ...options.initial };
  const server: Server = createServer((request, response) => {
    const snapshot = evaluateHealth(dependencies);
    const path = request.url?.split('?', 1)[0];
    if (path === '/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ live: true }));
      return;
    }
    if (path === '/ready') {
      response.writeHead(snapshot.ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify(snapshot));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(configuredPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('Health server did not expose a TCP address.');
  }

  return {
    host,
    port: address.port,
    snapshot: () => evaluateHealth(dependencies),
    update: next => {
      dependencies = { ...dependencies, ...next };
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

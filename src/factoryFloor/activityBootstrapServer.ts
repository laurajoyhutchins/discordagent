import { readFile as readFileDefault } from 'node:fs/promises';
import {
  createServer as createHttpsServer,
  type ServerOptions,
} from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { ActivityBootstrapServerConfig } from './activityBootstrapConfig.js';
import type { ActivityBootstrapHttpHandler } from './activityBootstrapHttp.js';

export interface ActivityBootstrapHttpsServer {
  once(event: 'error', handler: (error: Error) => void): unknown;
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
}

export interface ActivityBootstrapServerHandle {
  dispose(): Promise<void>;
}

export interface StartActivityBootstrapServerOptions {
  config: ActivityBootstrapServerConfig;
  handler: ActivityBootstrapHttpHandler;
  readFile?: (path: string) => Promise<Buffer>;
  createServer?: (
    options: ServerOptions,
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ) => ActivityBootstrapHttpsServer;
  logger?: (message: string) => void;
}

class NodeRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'NodeRequestError';
  }
}

function appendHeaders(target: Headers, source: IncomingHttpHeaders): void {
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) target.append(name, item);
    } else {
      target.set(name, value);
    }
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
  const method = request.method?.toUpperCase() ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    total += chunk.length;
    if (total > limit) throw new NodeRequestError('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function toRequest(
  request: IncomingMessage,
  config: ActivityBootstrapServerConfig,
): Promise<Request> {
  const headers = new Headers();
  appendHeaders(headers, request.headers);
  const body = await readBody(request, config.maxBodyBytes);
  return new Request(
    new URL(request.url ?? '/', config.publicOrigin),
    {
      method: request.method ?? 'GET',
      headers,
      ...(body ? { body } : {}),
    },
  );
}

async function writeResponse(
  target: ServerResponse,
  source: Response,
): Promise<void> {
  target.statusCode = source.status;
  source.headers.forEach((value, name) => target.setHeader(name, value));
  const bytes = Buffer.from(await source.arrayBuffer());
  target.setHeader('content-length', String(bytes.length));
  target.end(bytes);
}

function localFailure(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function startActivityBootstrapServer(
  options: StartActivityBootstrapServerOptions,
): Promise<ActivityBootstrapServerHandle> {
  const readFile = options.readFile ?? readFileDefault;
  const createServer = options.createServer
    ?? ((serverOptions, listener) => createHttpsServer(serverOptions, listener));
  const logger = options.logger ?? (() => undefined);
  const [cert, key] = await Promise.all([
    readFile(options.config.tlsCertPath),
    readFile(options.config.tlsKeyPath),
  ]);

  let started = false;
  let server: ActivityBootstrapHttpsServer;
  const handleRequest = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      try {
        const webRequest = await toRequest(request, options.config);
        await writeResponse(response, await options.handler(webRequest));
      } catch (error) {
        const failure = error instanceof NodeRequestError
          ? localFailure(413, error.code)
          : localFailure(500, 'internal_error');
        if (!(error instanceof NodeRequestError)) {
          logger('[factoryFloor] Activity bootstrap HTTPS request failed internally.');
        }
        await writeResponse(response, failure).catch(() => undefined);
      }
    })();
  };

  return await new Promise<ActivityBootstrapServerHandle>((resolve, reject) => {
    server = createServer({ cert, key }, handleRequest);
    server.once('error', error => {
      if (!started) reject(error);
      else logger('[factoryFloor] Activity bootstrap HTTPS server reported an error.');
    });
    server.listen(options.config.port, options.config.host, () => {
      started = true;
      resolve({
        dispose: () => new Promise<void>((resolveClose, rejectClose) => {
          server.close(error => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        }),
      });
    });
  });
}

import {
  ActivityBootstrapError,
  type ActivityBootstrapService,
  type BootstrapActivityInput,
  type StartActivityOAuthInput,
} from './activityBootstrapService.js';

export interface ActivityBootstrapHttpOptions {
  service: ActivityBootstrapService;
  allowedOrigins: readonly string[];
  maxBodyBytes?: number;
  logger?: (message: string) => void;
}

export type ActivityBootstrapHttpHandler = (request: Request) => Promise<Response>;

const START_PATH = '/api/v1/discord/activity/oauth/start';
const BOOTSTRAP_PATH = '/api/v1/discord/activity/bootstrap';

function normalizedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== value || (url.protocol !== 'https:' && url.hostname !== 'localhost')) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function jsonHeaders(origin?: string): Headers {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    pragma: 'no-cache',
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'POST, OPTIONS');
    headers.set('access-control-allow-headers', 'Content-Type');
    headers.set('access-control-max-age', '600');
  }
  return headers;
}

function response(
  status: number,
  payload: unknown,
  origin?: string,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders(origin),
  });
}

function failure(status: number, code: string, origin?: string): Response {
  return response(status, { error: { code } }, origin);
}

function errorStatus(error: ActivityBootstrapError): number {
  switch (error.kind) {
    case 'bad_request': return 400;
    case 'unauthorized': return 401;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'conflict': return 409;
    case 'expired': return 410;
    case 'upstream': return 502;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function readJson(request: Request, maxBodyBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new ActivityBootstrapError('bad_request', 'body_too_large');
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ActivityBootstrapError('bad_request', 'body_unreadable');
  }
  if (Buffer.byteLength(text, 'utf8') > maxBodyBytes) {
    throw new ActivityBootstrapError('bad_request', 'body_too_large');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ActivityBootstrapError('bad_request', 'invalid_json');
  }
}

export function createActivityBootstrapHttpHandler(
  options: ActivityBootstrapHttpOptions,
): ActivityBootstrapHttpHandler {
  const allowedOrigins = new Set(
    options.allowedOrigins.map(normalizedOrigin).filter((value): value is string => Boolean(value)),
  );
  if (allowedOrigins.size === 0) throw new Error('activity_bootstrap_origin_required');
  const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error('activity_bootstrap_body_limit_invalid');
  }
  const logger = options.logger ?? (() => undefined);

  return async request => {
    const origin = request.headers.get('origin') ?? '';
    if (!allowedOrigins.has(origin)) return failure(403, 'origin_not_allowed');
    const url = new URL(request.url);
    if (url.pathname !== START_PATH && url.pathname !== BOOTSTRAP_PATH) {
      return failure(404, 'route_not_found', origin);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jsonHeaders(origin) });
    }
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', origin);
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return failure(415, 'content_type_required', origin);
    }

    try {
      const parsed = object(await readJson(request, maxBodyBytes));
      if (!parsed) throw new ActivityBootstrapError('bad_request', 'invalid_json_object');
      if (url.pathname === START_PATH) {
        const input: StartActivityOAuthInput = {
          instanceId: string(parsed.instanceId),
          codeChallenge: string(parsed.codeChallenge),
        };
        return response(200, await options.service.startOAuth(input), origin);
      }
      const input: BootstrapActivityInput = {
        state: string(parsed.state),
        instanceId: string(parsed.instanceId),
        code: string(parsed.code),
        codeVerifier: string(parsed.codeVerifier),
        redirectUri: string(parsed.redirectUri),
      };
      return response(200, await options.service.bootstrap(input), origin);
    } catch (error) {
      if (error instanceof ActivityBootstrapError) {
        const status = error.code === 'body_too_large' ? 413 : errorStatus(error);
        return failure(status, error.code, origin);
      }
      logger('[factoryFloor] Activity bootstrap request failed with an internal error.');
      return failure(500, 'internal_error', origin);
    }
  };
}

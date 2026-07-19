import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

const SIGNATURE_VERSION = '1';
const DEFAULT_MAX_SKEW_MS = 30_000;
const MAX_NONCE_LENGTH = 128;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const TIMESTAMP_PATTERN = /^\d{1,16}$/;

export type ServiceAuthDirection = 'agent-to-ff' | 'ff-to-agent';
export type ServiceAuthBody = string | Uint8Array;

export interface ServiceAuthKeys {
  agentToFactoryKey: string;
  factoryToAgentKey: string;
  previousAgentToFactoryKey?: string;
  previousFactoryToAgentKey?: string;
}

export interface ServiceAuthNonceStore {
  consumeNonce(keyId: string, nonce: string, now: number): boolean | Promise<boolean>;
}

export interface VerifyServiceRequestOptions {
  keys: ServiceAuthKeys;
  nonceStore: ServiceAuthNonceStore;
  maxSkewMs?: number;
}

export interface SignedServiceRequest {
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export class ServiceAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
  ) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}

export function serviceAuthKeyId(direction: ServiceAuthDirection): string {
  return `ff-${direction}-v1`;
}

function currentKey(keys: ServiceAuthKeys, direction: ServiceAuthDirection): string {
  return direction === 'agent-to-ff'
    ? keys.agentToFactoryKey
    : keys.factoryToAgentKey;
}

function verificationKeys(
  keys: ServiceAuthKeys,
  direction: ServiceAuthDirection,
): string[] {
  const previous = direction === 'agent-to-ff'
    ? keys.previousAgentToFactoryKey
    : keys.previousFactoryToAgentKey;
  return previous
    ? [currentKey(keys, direction), previous]
    : [currentKey(keys, direction)];
}

function bodyBuffer(body: ServiceAuthBody): Buffer {
  return typeof body === 'string'
    ? Buffer.from(body, 'utf8')
    : Buffer.from(body);
}

function signaturePayload(
  direction: ServiceAuthDirection,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  body: ServiceAuthBody,
): string {
  return [
    SIGNATURE_VERSION,
    serviceAuthKeyId(direction),
    timestamp,
    nonce,
    method.toUpperCase(),
    path,
    createHash('sha256').update(bodyBuffer(body)).digest('hex'),
  ].join('\n');
}

export function signServiceRequest(
  keys: ServiceAuthKeys,
  direction: ServiceAuthDirection,
  method: string,
  path: string,
  body: ServiceAuthBody,
  now = Date.now(),
  nonce: string = randomUUID(),
): SignedServiceRequest {
  const timestamp = String(now);
  const keyId = serviceAuthKeyId(direction);
  const signature = createHmac('sha256', currentKey(keys, direction))
    .update(signaturePayload(direction, timestamp, nonce, method, path, body))
    .digest('hex');

  return { keyId, timestamp, nonce, signature };
}

export function formatServiceAuthHeader(input: SignedServiceRequest): string {
  return `HMAC-SHA256 keyId=${input.keyId},timestamp=${input.timestamp},nonce=${input.nonce},signature=${input.signature}`;
}

export function parseServiceAuthHeader(header: string): SignedServiceRequest | undefined {
  const match =
    /^HMAC-SHA256\s+keyId=([^,]+),timestamp=([^,]+),nonce=([^,]+),signature=([^,]+)$/.exec(
      header,
    );
  if (!match) return undefined;
  return {
    keyId: match[1],
    timestamp: match[2],
    nonce: match[3],
    signature: match[4],
  };
}

export async function verifyServiceRequest(
  options: VerifyServiceRequestOptions,
  direction: ServiceAuthDirection,
  method: string,
  path: string,
  body: ServiceAuthBody,
  header: string | undefined,
  now = Date.now(),
): Promise<void> {
  if (!header) throw new ServiceAuthError('service_auth_header_required');

  const parsed = parseServiceAuthHeader(header);
  if (!parsed) throw new ServiceAuthError('service_auth_header_malformed');

  if (parsed.keyId !== serviceAuthKeyId(direction)) {
    throw new ServiceAuthError('service_auth_unknown_key');
  }
  if (!TIMESTAMP_PATTERN.test(parsed.timestamp)) {
    throw new ServiceAuthError('service_auth_invalid_timestamp');
  }

  const timestamp = Number(parsed.timestamp);
  if (!Number.isSafeInteger(timestamp)) {
    throw new ServiceAuthError('service_auth_invalid_timestamp');
  }
  if (Math.abs(now - timestamp) > (options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS)) {
    throw new ServiceAuthError('service_auth_timestamp_skew');
  }

  if (parsed.nonce.trim() === '') {
    throw new ServiceAuthError('service_auth_nonce_required');
  }
  if (parsed.nonce.length > MAX_NONCE_LENGTH) {
    throw new ServiceAuthError('service_auth_nonce_too_long');
  }
  if (!SIGNATURE_PATTERN.test(parsed.signature)) {
    throw new ServiceAuthError('service_auth_signature_mismatch');
  }

  const payload = signaturePayload(
    direction,
    parsed.timestamp,
    parsed.nonce,
    method,
    path,
    body,
  );
  const supplied = Buffer.from(parsed.signature, 'hex');
  let matched = false;

  for (const key of verificationKeys(options.keys, direction)) {
    const expected = createHmac('sha256', key).update(payload).digest();
    const candidateMatches =
      supplied.length === expected.length && timingSafeEqual(supplied, expected);
    matched = matched || candidateMatches;
  }

  if (!matched) throw new ServiceAuthError('service_auth_signature_mismatch');
  if (!(await options.nonceStore.consumeNonce(parsed.keyId, parsed.nonce, now))) {
    throw new ServiceAuthError('service_auth_nonce_replayed');
  }
}

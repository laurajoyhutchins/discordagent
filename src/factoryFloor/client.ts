import {
  formatServiceAuthHeader,
  signServiceRequest,
  type ServiceAuthKeys,
} from './serviceAuth.js';

export interface CreateActivitySessionRequest {
  applicationId: string;
  instanceId: string;
  installationId: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
  launchId: string;
  principalId: string;
  adapter: string;
  boundRunId?: string;
}

export interface ActivitySessionResponse {
  instanceBindingId: string;
  sessionToken: string;
  expiresAt: string;
  idleExpiresAt: string;
}

export interface RefreshedActivitySessionResponse {
  sessionToken: string;
  expiresAt: string;
  idleExpiresAt: string;
}

export interface FactoryFloorStatus {
  status: string;
  generatedAt?: string;
  readyDeliveries?: number;
  activeExecutions?: number;
  pendingApprovals?: number;
  recentFailures?: number;
}

export interface FactoryFloorRunStatus {
  runId: string;
  status: string;
  commandType?: string;
  regionId?: string;
  regionName?: string;
  pendingApprovalCount?: number;
  terminalResultSummary?: string | null;
}

export interface FactoryFloorTaskRequest {
  clientRequestId: string;
  repository: string;
  objective: string;
  acceptanceCriteria: string[];
  authority?: {
    mayCreateBranch?: boolean;
    mayOpenDraftPullRequest?: boolean;
    mayMerge?: boolean;
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface FactoryFloorTaskReceipt {
  runId: string;
  commandId: string;
  regionId: string;
  regionName: string;
  status: string;
  disposition: 'accepted' | 'replayed' | 'rejected';
  rejection?: unknown;
}

export interface FactoryFloorApproval {
  id: string;
  status: string;
  requested_at?: string;
  policy_name?: string;
  policy_version?: string;
  subject_kind?: string;
  subject_id?: string;
  reason?: string;
}

export type FactoryFloorClientErrorKind =
  | 'configuration'
  | 'timeout'
  | 'unavailable'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'remote'
  | 'malformed_response';

export class FactoryFloorClientError extends Error {
  constructor(
    public readonly kind: FactoryFloorClientErrorKind,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(`Factory Floor request failed: ${code}`);
    this.name = 'FactoryFloorClientError';
  }
}

interface RequesterOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: HeadersInit;
  retryable?: boolean;
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FactoryFloorClientError(
      'configuration',
      'factory_floor_base_url_invalid',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FactoryFloorClientError(
      'configuration',
      'factory_floor_base_url_protocol_invalid',
    );
  }
  return url;
}

function errorKind(status: number): FactoryFloorClientErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 409 || status === 410) return 'conflict';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'remote';
}

function errorCode(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    if (typeof parsed.error?.code === 'string' && parsed.error.code.trim()) {
      return parsed.error.code.trim();
    }
  } catch {
    // The raw response is intentionally not propagated into logs or errors.
  }
  return `http_${status}`;
}

class FactoryFloorRequester {
  readonly baseUrl: URL;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly fetchFn: typeof fetch;

  constructor(options: RequesterOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.fetchFn = options.fetchFn ?? fetch;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new FactoryFloorClientError('configuration', 'factory_floor_timeout_invalid');
    }
    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 3) {
      throw new FactoryFloorClientError('configuration', 'factory_floor_retries_invalid');
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const attempts = options.retryable ? this.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchFn(new URL(path, this.baseUrl), {
          method,
          body: options.body,
          headers: options.headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error: unknown) {
        const timedOut = error instanceof Error && (
          error.name === 'TimeoutError' || error.name === 'AbortError'
        );
        if (attempt + 1 < attempts) continue;
        throw new FactoryFloorClientError(
          timedOut ? 'timeout' : 'unavailable',
          timedOut ? 'factory_floor_request_timeout' : 'factory_floor_unavailable',
        );
      }

      const text = response.status === 204 ? '' : await response.text();
      if (!response.ok) {
        if (
          options.retryable &&
          attempt + 1 < attempts &&
          [502, 503, 504].includes(response.status)
        ) {
          continue;
        }
        throw new FactoryFloorClientError(
          errorKind(response.status),
          errorCode(text, response.status),
          response.status,
        );
      }
      if (response.status === 204) return undefined as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new FactoryFloorClientError(
          'malformed_response',
          'factory_floor_malformed_response',
          response.status,
        );
      }
    }

    throw new FactoryFloorClientError('unavailable', 'factory_floor_unavailable');
  }
}

export interface FactoryFloorServiceClientOptions extends RequesterOptions {
  keys: ServiceAuthKeys;
  now?: () => number;
  nonce?: () => string;
}

export class FactoryFloorServiceClient {
  private readonly requester: FactoryFloorRequester;
  private readonly keys: ServiceAuthKeys;
  private readonly now: () => number;
  private readonly nonce?: () => string;

  constructor(options: FactoryFloorServiceClientOptions) {
    this.requester = new FactoryFloorRequester(options);
    this.keys = options.keys;
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce;
  }

  createOrJoinActivitySession(
    input: CreateActivitySessionRequest,
  ): Promise<ActivitySessionResponse> {
    return this.signedPost('/api/v1/discord/activity/sessions', input);
  }

  refreshActivitySession(
    sessionToken: string,
  ): Promise<RefreshedActivitySessionResponse> {
    return this.signedPost('/api/v1/discord/activity/sessions/refresh', {
      sessionToken,
    });
  }

  async revokeActivitySession(sessionToken: string): Promise<void> {
    await this.signedPost<void>('/api/v1/discord/activity/sessions/revoke', {
      sessionToken,
    });
  }

  private signedPost<T>(path: string, input: unknown): Promise<T> {
    const body = JSON.stringify(input);
    const signed = signServiceRequest(
      this.keys,
      'agent-to-ff',
      'POST',
      path,
      body,
      this.now(),
      this.nonce?.(),
    );
    return this.requester.request<T>(path, {
      method: 'POST',
      body,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-factory-floor-service-auth': formatServiceAuthHeader(signed),
      },
    });
  }
}

export interface FactoryFloorOperatorClientOptions extends RequesterOptions {
  operatorToken: string;
  adapter?: string;
}

export class FactoryFloorOperatorClient {
  private readonly requester: FactoryFloorRequester;
  private readonly token: string;
  private readonly adapter: string;

  constructor(options: FactoryFloorOperatorClientOptions) {
    this.requester = new FactoryFloorRequester(options);
    this.token = options.operatorToken.trim();
    this.adapter = options.adapter?.trim() || 'discord-agent';
    if (!this.token) {
      throw new FactoryFloorClientError(
        'configuration',
        'factory_floor_operator_token_required',
      );
    }
  }

  getStatus(principalId: string): Promise<FactoryFloorStatus> {
    return this.request('/api/v1/operator/status', principalId, true);
  }

  submitTask(
    principalId: string,
    input: FactoryFloorTaskRequest,
  ): Promise<FactoryFloorTaskReceipt> {
    return this.request('/api/v1/operator/tasks', principalId, false, input);
  }

  getRun(principalId: string, runId: string): Promise<FactoryFloorRunStatus> {
    return this.request(
      `/api/v1/operator/runs/${encodeURIComponent(runId)}`,
      principalId,
      true,
    );
  }

  async listApprovals(
    principalId: string,
    limit = 10,
  ): Promise<FactoryFloorApproval[]> {
    const response = await this.request<{ items: FactoryFloorApproval[] }>(
      `/api/v1/operator/approvals?limit=${encodeURIComponent(String(limit))}`,
      principalId,
      true,
    );
    return response.items;
  }

  private request<T>(
    path: string,
    principalId: string,
    retryable: boolean,
    input?: unknown,
  ): Promise<T> {
    const principal = principalId.trim();
    if (!principal) {
      throw new FactoryFloorClientError(
        'configuration',
        'factory_floor_principal_required',
      );
    }
    const body = input === undefined ? undefined : JSON.stringify(input);
    return this.requester.request<T>(path, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      retryable,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-factory-floor-principal-id': principal,
        'x-factory-floor-adapter': this.adapter,
      },
    });
  }
}

export type FactoryFloorRunState =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected';

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
  commandType?: string;
  regionId?: string;
  regionName?: string;
  status: FactoryFloorRunState;
  counts?: {
    queued: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  retryCount?: number;
  pendingApprovalCount?: number;
  blockingReason?: unknown;
  createdAt?: string;
  completedAt?: string | null;
  terminalResultSummary?: string | null;
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
  normalized_inputs?: unknown;
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

export class FactoryFloorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FactoryFloorApiError';
  }
}

export interface FactoryFloorClientOptions {
  baseUrl: string;
  operatorToken: string;
  adapter?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class FactoryFloorClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly adapter: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: FactoryFloorClientOptions) {
    const token = options.operatorToken.trim();
    if (!token) throw new Error('FACTORY_FLOOR_OPERATOR_TOKEN is required when the bridge is enabled');
    this.baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol))
      throw new Error('FACTORY_FLOOR_BASE_URL must use http or https');
    this.token = token;
    this.adapter = options.adapter?.trim() || 'discord-agent';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  getStatus(principalId: string): Promise<FactoryFloorStatus> {
    return this.request('/api/v1/operator/status', principalId);
  }

  submitTask(
    principalId: string,
    input: FactoryFloorTaskRequest,
  ): Promise<FactoryFloorTaskReceipt> {
    return this.request('/api/v1/operator/tasks', principalId, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getRun(principalId: string, runId: string): Promise<FactoryFloorRunStatus> {
    return this.request(`/api/v1/operator/runs/${encodeURIComponent(runId)}`, principalId);
  }

  cancelRun(
    principalId: string,
    runId: string,
    input: { clientRequestId: string; reason: string },
  ): Promise<unknown> {
    return this.request(
      `/api/v1/operator/runs/${encodeURIComponent(runId)}/cancel`,
      principalId,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  async listApprovals(principalId: string, limit = 10): Promise<FactoryFloorApproval[]> {
    const response = await this.request<{ items: FactoryFloorApproval[] }>(
      `/api/v1/operator/approvals?limit=${encodeURIComponent(String(limit))}`,
      principalId,
    );
    return response.items;
  }

  decideApproval(
    principalId: string,
    approvalId: string,
    input: { clientRequestId: string; decision: 'approve' | 'reject'; reason: string },
  ): Promise<unknown> {
    return this.request(
      `/api/v1/operator/approvals/${encodeURIComponent(approvalId)}/decision`,
      principalId,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  private async request<T>(
    path: string,
    principalId: string,
    init: RequestInit = {},
  ): Promise<T> {
    const principal = principalId.trim();
    if (!principal) throw new Error('Factory Floor principal ID is required');
    const url = new URL(path, this.baseUrl);
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    headers.set('accept', 'application/json');
    headers.set('x-factory-floor-principal-id', principal);
    headers.set('x-factory-floor-adapter', this.adapter);
    if (init.body !== undefined) headers.set('content-type', 'application/json');

    const response = await this.fetchFn(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json().catch(() => undefined) as
      | { error?: { code?: string; message?: string } }
      | T
      | undefined;
    if (!response.ok) {
      const error = payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : undefined;
      throw new FactoryFloorApiError(
        response.status,
        error?.code ?? `http_${response.status}`,
        error?.message ?? `Factory Floor request failed with HTTP ${response.status}`,
      );
    }
    if (payload === undefined) throw new FactoryFloorApiError(502, 'malformed_response', 'Factory Floor returned no JSON response');
    return payload as T;
  }
}

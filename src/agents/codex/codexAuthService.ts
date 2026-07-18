import { randomUUID } from 'node:crypto';
import type { AppServerTransport } from './appServerTransport.js';
import { isRecord } from './protocol.js';

export interface CodexAccountState {
  authenticated: boolean;
  authenticationRequired: boolean;
  authMode?: string;
  planType?: string;
  email?: string;
}

export interface DeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: number;
}

export interface CodexRateLimitWindow {
  name: string;
  utilization?: number;
  remaining?: number;
  resetsAt?: number;
  windowDurationMins?: number;
}

export class CodexAuthService {
  private activeLogin: DeviceLogin | undefined;
  private loginExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(state: CodexAccountState) => void>();
  private readonly rateLimitListeners = new Set<(windows: CodexRateLimitWindow[]) => void>();
  private readonly notificationListener: (method: string, params: unknown) => void;

  constructor(private readonly transport: AppServerTransport) {
    this.notificationListener = (method: string, params: unknown) => {
      if (method === 'account/updated' || method === 'account/login/completed') {
        void this.readAccount().then(state => this.listeners.forEach(listener => listener(state))).catch(() => {});
      }
      if (method === 'account/login/completed' && isRecord(params)) {
        const completedId = typeof params.loginId === 'string' ? params.loginId : undefined;
        if (!completedId || completedId === this.activeLogin?.loginId) this.clearActiveLogin();
      }
      if (method === 'account/rateLimits/updated') {
        const windows = parseRateLimitResponse(params);
        this.rateLimitListeners.forEach(listener => listener(windows));
      }
    };
    transport.on('notification', this.notificationListener);
  }

  onAccountUpdated(listener: (state: CodexAccountState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRateLimitsUpdated(listener: (windows: CodexRateLimitWindow[]) => void): () => void {
    this.rateLimitListeners.add(listener);
    return () => this.rateLimitListeners.delete(listener);
  }

  async readAccount(): Promise<CodexAccountState> {
    const result = await this.transport.request('account/read', { refreshToken: false });
    if (!isRecord(result)) return { authenticated: false, authenticationRequired: true };
    const account = isRecord(result.account) ? result.account : undefined;
    const requiresOpenaiAuth = Boolean(result.requiresOpenaiAuth ?? result.authenticationRequired);
    const authenticationRequired = requiresOpenaiAuth && !account;
    return {
      authenticated: Boolean(account) || !requiresOpenaiAuth,
      authenticationRequired,
      ...(typeof account?.type === 'string' ? { authMode: account.type } : {}),
      ...(typeof account?.planType === 'string' ? { planType: account.planType } : {}),
      ...(typeof account?.email === 'string' ? { email: account.email } : {}),
    };
  }

  async startDeviceLogin(): Promise<DeviceLogin> {
    if (this.activeLogin) throw new Error('A Codex sign-in is already in progress');
    const result = await this.transport.request('account/login/start', { type: 'chatgptDeviceCode' });
    if (!isRecord(result)) throw new Error('Codex did not return device-login details');
    const login: DeviceLogin = {
      loginId: typeof result.loginId === 'string' ? result.loginId : randomUUID(),
      verificationUrl: String(result.verificationUrl ?? ''),
      userCode: String(result.userCode ?? ''),
      expiresAt: normalizeExpiry(typeof result.expiresAt === 'number' ? result.expiresAt : undefined),
    };
    if (!login.verificationUrl || !login.userCode) throw new Error('Codex device login is unavailable');
    this.activeLogin = login;
    this.loginExpiryTimer = setTimeout(() => this.clearActiveLogin(), Math.max(0, login.expiresAt! - Date.now()));
    this.loginExpiryTimer.unref?.();
    return login;
  }

  async cancelLogin(): Promise<void> {
    if (!this.activeLogin) return;
    const id = this.activeLogin.loginId;
    this.clearActiveLogin();
    await this.transport.request('account/login/cancel', { loginId: id }).catch(() => undefined);
  }

  async logout(): Promise<void> {
    await this.transport.request('account/logout');
    this.clearActiveLogin();
  }

  async readRateLimits(): Promise<CodexRateLimitWindow[]> {
    const result = await this.transport.request('account/rateLimits/read');
    return parseRateLimitResponse(result);
  }

  getPendingLogin(): DeviceLogin | undefined {
    if (this.activeLogin?.expiresAt !== undefined && this.activeLogin.expiresAt <= Date.now()) this.clearActiveLogin();
    return this.activeLogin;
  }

  async close(): Promise<void> {
    await this.cancelLogin();
    this.transport.off('notification', this.notificationListener);
    this.listeners.clear();
    this.rateLimitListeners.clear();
  }

  private clearActiveLogin(): void {
    this.activeLogin = undefined;
    if (this.loginExpiryTimer) clearTimeout(this.loginExpiryTimer);
    this.loginExpiryTimer = undefined;
  }
}

function normalizeExpiry(value: number | undefined): number {
  const candidate = value === undefined ? Date.now() + 30 * 60_000 : value < 1_000_000_000_000 ? value * 1000 : value;
  return Math.min(candidate, Date.now() + 30 * 60_000);
}

function parseRateLimitResponse(value: unknown): CodexRateLimitWindow[] {
  if (!isRecord(value)) return [];
  const buckets = isRecord(value.rateLimitsByLimitId)
    ? Object.entries(value.rateLimitsByLimitId).flatMap(([id, bucket]) => isRecord(bucket) ? [[id, bucket] as const] : [])
    : isRecord(value.rateLimits)
      ? [[String(value.rateLimits.limitId ?? 'codex'), value.rateLimits] as const]
      : [];
  return buckets.flatMap(([id, bucket]) => {
    const label = typeof bucket.limitName === 'string' && bucket.limitName ? bucket.limitName : id;
    return (['primary', 'secondary'] as const).flatMap(kind => {
      const window = isRecord(bucket[kind]) ? bucket[kind] : undefined;
      if (!window) return [];
      const utilization = numberOrUndefined(window.usedPercent);
      return [{
        name: `${label}:${kind}`,
        utilization,
        remaining: utilization === undefined ? undefined : Math.max(0, 100 - utilization),
        resetsAt: numberOrUndefined(window.resetsAt),
        windowDurationMins: numberOrUndefined(window.windowDurationMins),
      }];
    });
  });
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

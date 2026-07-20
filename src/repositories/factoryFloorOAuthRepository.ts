import { createHash } from 'node:crypto';
import type { DatabaseHandle } from '../db/database.js';

export interface FactoryFloorOAuthAttempt {
  stateId: string;
  instanceId: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface BeginFactoryFloorOAuthAttemptInput {
  stateId: string;
  instanceId: string;
  codeChallenge: string;
  createdAt?: number;
  expiresAt: number;
}

export interface VerifyFactoryFloorOAuthAttemptInput {
  stateId: string;
  instanceId: string;
  codeVerifier: string;
  now: number;
}

export interface FactoryFloorOAuthRepository {
  begin(input: BeginFactoryFloorOAuthAttemptInput): FactoryFloorOAuthAttempt;
  findByStateId(stateId: string): FactoryFloorOAuthAttempt | undefined;
  verifyAndConsume(input: VerifyFactoryFloorOAuthAttemptInput): FactoryFloorOAuthAttempt | undefined;
  cleanup(now?: number): number;
}

export class FactoryFloorOAuthConflictError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FactoryFloorOAuthConflictError';
  }
}

interface AttemptRow {
  state_id: string;
  instance_id: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface LaunchRow {
  expires_at: number;
  consumed_at: number | null;
  invalidated_at: number | null;
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function time(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field}_invalid`);
  return value;
}

function map(row: AttemptRow): FactoryFloorOAuthAttempt {
  return {
    stateId: row.state_id,
    instanceId: row.instance_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? undefined,
  };
}

export function createFactoryFloorOAuthRepository(db: DatabaseHandle): FactoryFloorOAuthRepository {
  const attempt = db.raw.prepare(`
    SELECT state_id, instance_id, code_challenge, code_challenge_method,
           created_at, expires_at, consumed_at
    FROM factory_floor_oauth_attempts WHERE state_id = ?
  `);
  const launch = db.raw.prepare(`
    SELECT expires_at, consumed_at, invalidated_at
    FROM factory_floor_launch_states WHERE state_id = ?
  `);

  const findByStateId = (stateId: string): FactoryFloorOAuthAttempt | undefined => {
    const row = attempt.get(text(stateId, 'state_id')) as AttemptRow | undefined;
    return row ? map(row) : undefined;
  };

  const consume = db.raw.transaction((input: VerifyFactoryFloorOAuthAttemptInput) => {
    const stateId = text(input.stateId, 'state_id');
    const instanceId = text(input.instanceId, 'instance_id');
    const verifier = text(input.codeVerifier, 'code_verifier');
    const now = time(input.now, 'consumed_at');
    if (!VERIFIER.test(verifier)) return undefined;
    const expected = createHash('sha256').update(verifier).digest('base64url');
    const current = attempt.get(stateId) as AttemptRow | undefined;
    const currentLaunch = launch.get(stateId) as LaunchRow | undefined;
    if (
      !current || !currentLaunch || current.instance_id !== instanceId
      || current.code_challenge !== expected || current.consumed_at !== null
      || current.expires_at <= now || currentLaunch.expires_at <= now
      || currentLaunch.consumed_at !== null || currentLaunch.invalidated_at !== null
    ) return undefined;
    const result = db.raw.prepare(`
      UPDATE factory_floor_oauth_attempts SET consumed_at = ?
      WHERE state_id = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(now, stateId, now);
    return result.changes === 1 ? findByStateId(stateId) : undefined;
  });

  return {
    begin(input) {
      const stateId = text(input.stateId, 'state_id');
      const instanceId = text(input.instanceId, 'instance_id');
      const codeChallenge = text(input.codeChallenge, 'code_challenge');
      if (!CHALLENGE.test(codeChallenge)) throw new Error('code_challenge_invalid');
      const createdAt = time(input.createdAt ?? Date.now(), 'created_at');
      const expiresAt = time(input.expiresAt, 'expires_at');
      if (expiresAt <= createdAt) throw new Error('oauth_expiry_invalid');
      const currentLaunch = launch.get(stateId) as LaunchRow | undefined;
      if (!currentLaunch || currentLaunch.consumed_at !== null
        || currentLaunch.invalidated_at !== null || currentLaunch.expires_at <= createdAt) {
        throw new FactoryFloorOAuthConflictError('launch_state_unavailable');
      }
      if (expiresAt > currentLaunch.expires_at) {
        throw new FactoryFloorOAuthConflictError('oauth_expiry_exceeds_launch');
      }
      const existing = attempt.get(stateId) as AttemptRow | undefined;
      if (existing) {
        if (existing.instance_id === instanceId && existing.code_challenge === codeChallenge
          && existing.consumed_at === null && existing.expires_at > createdAt) return map(existing);
        throw new FactoryFloorOAuthConflictError('oauth_attempt_conflict');
      }
      db.raw.prepare(`
        INSERT INTO factory_floor_oauth_attempts (
          state_id, instance_id, code_challenge, code_challenge_method, created_at, expires_at
        ) VALUES (?, ?, ?, 'S256', ?, ?)
      `).run(stateId, instanceId, codeChallenge, createdAt, expiresAt);
      return findByStateId(stateId)!;
    },
    findByStateId,
    verifyAndConsume(input) { return consume(input); },
    cleanup(now = Date.now()) {
      const result = db.raw.prepare(`
        DELETE FROM factory_floor_oauth_attempts
        WHERE expires_at <= ? OR consumed_at IS NOT NULL
      `).run(time(now, 'cleanup_at'));
      return result.changes;
    },
  };
}

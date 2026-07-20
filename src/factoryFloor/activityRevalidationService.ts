import type {
  FactoryFloorBindingRepository,
  FactoryFloorProjectBinding,
  FactoryFloorRunBinding,
  FactoryFloorSurfaceBinding,
} from '../repositories/factoryFloorBindingRepository.js';
import {
  DiscordActivityApiError,
  type DiscordActivityApiClient,
  type DiscordActivityInstance,
} from './discordOAuthClient.js';

export type ActivityRevalidationAction = 'approve' | 'cancel';

export type ActivityRevalidationReasonCode =
  | 'authorized'
  | 'invalid_request'
  | 'unsupported_action'
  | 'rate_limited'
  | 'activity_instance_not_found'
  | 'activity_instance_unavailable'
  | 'activity_application_mismatch'
  | 'activity_location_mismatch'
  | 'activity_principal_not_present'
  | 'installation_mismatch'
  | 'guild_mismatch'
  | 'member_not_found'
  | 'member_unavailable'
  | 'principal_mismatch'
  | 'not_authorized'
  | 'project_binding_not_found'
  | 'surface_binding_not_found'
  | 'run_binding_not_found'
  | 'binding_mismatch'
  | 'adapter_mismatch';

export interface ActivityRevalidationRequest {
  applicationId: string;
  instanceId: string;
  installationId: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  principalId: string;
  adapter: string;
  projectId: string;
  runId: string;
  action: string;
}

export interface ActivityRevalidationResponse {
  schemaVersion: 1;
  allowed: boolean;
  reasonCode: ActivityRevalidationReasonCode;
  action: string;
  principalId?: string;
  runId?: string;
  revalidatedAt: number;
}

export type ActivityRevalidationMemberResolution =
  | { kind: 'member'; userId: string; authorized: boolean }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

export interface ActivityRevalidationDependencies {
  applicationId: string;
  guildId: string;
  adapter?: string;
  timeoutMs?: number;
  maxRequests?: number;
  rateLimitWindowMs?: number;
  now?: () => number;
  discord: Pick<DiscordActivityApiClient, 'getActivityInstance'>;
  bindings: Pick<
    FactoryFloorBindingRepository,
    'findProjectByFactoryFloorId' | 'findSurfaceByActivityInstance' | 'findRun'
  >;
  resolveMember(
    guildId: string,
    userId: string,
    action: ActivityRevalidationAction,
  ): Promise<ActivityRevalidationMemberResolution>;
  onDecision?: (decision: {
    allowed: boolean;
    reasonCode: ActivityRevalidationReasonCode;
    action: string;
  }) => void;
}

export interface ActivityRevalidationService {
  revalidate(input: ActivityRevalidationRequest): Promise<ActivityRevalidationResponse>;
}

interface RateLimitWindow {
  startedAt: number;
  count: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const TIMEOUT: unique symbol = Symbol('activity_revalidation_timeout');

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

function sameProject(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

async function bounded<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>(resolve => {
        timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentMember(
  dependencies: ActivityRevalidationDependencies,
  guildId: string,
  userId: string,
  action: ActivityRevalidationAction,
  timeoutMs: number,
): Promise<ActivityRevalidationMemberResolution | typeof TIMEOUT> {
  try {
    return await bounded(
      dependencies.resolveMember(guildId, userId, action),
      timeoutMs,
    );
  } catch {
    return TIMEOUT;
  }
}

function expectedLocationChannel(input: ActivityRevalidationRequest): string {
  return normalized(input.threadId) || normalized(input.channelId);
}

function validRequest(input: ActivityRevalidationRequest): boolean {
  return [
    input.applicationId,
    input.instanceId,
    input.installationId,
    input.guildId,
    input.channelId,
    input.principalId,
    input.adapter,
    input.projectId,
    input.runId,
    input.action,
  ].every(value => normalized(value) !== '');
}

function bindingMatches(
  input: ActivityRevalidationRequest,
  project: FactoryFloorProjectBinding,
  surface: FactoryFloorSurfaceBinding,
  run: FactoryFloorRunBinding,
): boolean {
  return project.factoryFloorProjectId === input.projectId
    && project.guildId === input.guildId
    && sameProject(surface.projectName, project.projectName)
    && surface.guildId === input.guildId
    && surface.channelId === input.channelId
    && normalized(surface.threadId) === normalized(input.threadId)
    && surface.activityInstanceId === input.instanceId
    && run.runId === input.runId
    && sameProject(run.projectName, project.projectName)
    && run.surfaceId === surface.id;
}

async function liveInstance(
  dependencies: ActivityRevalidationDependencies,
  instanceId: string,
  timeoutMs: number,
): Promise<DiscordActivityInstance | ActivityRevalidationReasonCode> {
  try {
    const result = await bounded(
      dependencies.discord.getActivityInstance(instanceId),
      timeoutMs,
    );
    return result === TIMEOUT ? 'activity_instance_unavailable' : result;
  } catch (error) {
    return error instanceof DiscordActivityApiError && error.kind === 'not_found'
      ? 'activity_instance_not_found'
      : 'activity_instance_unavailable';
  }
}

export function createActivityRevalidationService(
  dependencies: ActivityRevalidationDependencies,
): ActivityRevalidationService {
  const applicationId = normalized(dependencies.applicationId);
  const guildId = normalized(dependencies.guildId);
  const adapter = normalized(dependencies.adapter) || 'discord-agent';
  if (!applicationId) throw new Error('activity_application_id_required');
  if (!guildId) throw new Error('activity_guild_id_required');
  const timeoutMs = positiveInteger(
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'activity_revalidation_timeout_invalid',
  );
  const maxRequests = positiveInteger(
    dependencies.maxRequests ?? DEFAULT_MAX_REQUESTS,
    'activity_revalidation_rate_limit_invalid',
  );
  const rateLimitWindowMs = positiveInteger(
    dependencies.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    'activity_revalidation_rate_window_invalid',
  );
  const now = dependencies.now ?? Date.now;
  const windows = new Map<string, RateLimitWindow>();

  const finish = (
    input: ActivityRevalidationRequest,
    reasonCode: ActivityRevalidationReasonCode,
    at: number,
  ): ActivityRevalidationResponse => {
    const allowed = reasonCode === 'authorized';
    const response: ActivityRevalidationResponse = {
      schemaVersion: 1,
      allowed,
      reasonCode,
      action: input.action,
      ...(allowed ? { principalId: input.principalId, runId: input.runId } : {}),
      revalidatedAt: at,
    };
    dependencies.onDecision?.({ allowed, reasonCode, action: input.action });
    return response;
  };

  const rateLimited = (input: ActivityRevalidationRequest, at: number): boolean => {
    const key = `${input.principalId}\n${input.action}`;
    const current = windows.get(key);
    if (!current || at - current.startedAt >= rateLimitWindowMs) {
      windows.set(key, { startedAt: at, count: 1 });
      return false;
    }
    if (current.count >= maxRequests) return true;
    current.count += 1;
    return false;
  };

  return {
    async revalidate(input) {
      const at = now();
      if (!validRequest(input)) return finish(input, 'invalid_request', at);
      if (input.action !== 'approve' && input.action !== 'cancel') {
        return finish(input, 'unsupported_action', at);
      }
      if (input.applicationId !== applicationId) {
        return finish(input, 'activity_application_mismatch', at);
      }
      if (input.installationId !== input.guildId) {
        return finish(input, 'installation_mismatch', at);
      }
      if (input.guildId !== guildId) return finish(input, 'guild_mismatch', at);
      if (input.adapter !== adapter) return finish(input, 'adapter_mismatch', at);
      if (rateLimited(input, at)) return finish(input, 'rate_limited', at);

      const instance = await liveInstance(dependencies, input.instanceId, timeoutMs);
      if (typeof instance === 'string') return finish(input, instance, at);
      if (instance.applicationId !== applicationId || instance.instanceId !== input.instanceId) {
        return finish(input, 'activity_application_mismatch', at);
      }
      if (
        instance.location.kind !== 'gc'
        || instance.location.guildId !== input.guildId
        || instance.location.channelId !== expectedLocationChannel(input)
      ) {
        return finish(input, 'activity_location_mismatch', at);
      }
      if (!instance.users.includes(input.principalId)) {
        return finish(input, 'activity_principal_not_present', at);
      }

      const project = dependencies.bindings.findProjectByFactoryFloorId(input.projectId);
      if (!project) return finish(input, 'project_binding_not_found', at);
      const surface = dependencies.bindings.findSurfaceByActivityInstance(input.instanceId);
      if (!surface) return finish(input, 'surface_binding_not_found', at);
      const run = dependencies.bindings.findRun(input.runId);
      if (!run) return finish(input, 'run_binding_not_found', at);
      if (!bindingMatches(input, project, surface, run)) {
        return finish(input, 'binding_mismatch', at);
      }

      const member = await currentMember(
        dependencies,
        input.guildId,
        input.principalId,
        input.action,
        timeoutMs,
      );
      if (member === TIMEOUT || member.kind === 'unavailable') {
        return finish(input, 'member_unavailable', at);
      }
      if (member.kind === 'missing') return finish(input, 'member_not_found', at);
      if (member.userId !== input.principalId) {
        return finish(input, 'principal_mismatch', at);
      }
      if (!member.authorized) return finish(input, 'not_authorized', at);

      return finish(input, 'authorized', at);
    },
  };
}

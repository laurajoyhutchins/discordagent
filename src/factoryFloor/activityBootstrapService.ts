import { createHash } from 'node:crypto';
import type {
  FactoryFloorLaunchContext,
  FactoryFloorLaunchRecord,
  FactoryFloorLaunchRepository,
} from '../repositories/factoryFloorLaunchRepository.js';
import type { FactoryFloorLaunchInteractionLookup } from '../repositories/factoryFloorLaunchInteractionLookup.js';
import {
  FactoryFloorOAuthConflictError,
  type FactoryFloorOAuthRepository,
} from '../repositories/factoryFloorOAuthRepository.js';
import type {
  ActivitySessionResponse,
  FactoryFloorServiceClient,
} from './client.js';
import {
  DiscordActivityApiError,
  type DiscordActivityApiClient,
  type DiscordActivityInstance,
  type DiscordOAuthToken,
} from './discordOAuthClient.js';

export type ActivityBootstrapErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'upstream';

export class ActivityBootstrapError extends Error {
  constructor(
    public readonly kind: ActivityBootstrapErrorKind,
    public readonly code: string,
  ) {
    super(`Activity bootstrap failed: ${code}`);
    this.name = 'ActivityBootstrapError';
  }
}

export interface ActivityMemberResolution {
  userId: string;
  authorized: boolean;
}

export interface StartActivityOAuthInput {
  instanceId: string;
  codeChallenge: string;
}

export interface StartActivityOAuthResponse {
  state: string;
  clientId: string;
  scopes: readonly string[];
  codeChallengeMethod: 'S256';
  expiresAt: number;
}

export interface BootstrapActivityInput {
  state: string;
  instanceId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface BootstrapActivityResponse {
  discord: DiscordOAuthToken;
  factoryFloor: ActivitySessionResponse;
  context: {
    kind: 'project' | 'run';
    projectId: string;
    runId?: string;
  };
}

export interface ActivityBootstrapDependencies {
  applicationId: string;
  oauthScopes: readonly string[];
  oauthTtlMs: number;
  allowedRedirectUris?: readonly string[];
  adapter?: string;
  now?: () => number;
  discord: Pick<
    DiscordActivityApiClient,
    'getActivityInstance' | 'exchangeAuthorizationCode' | 'getCurrentUser'
  >;
  launchLookup: FactoryFloorLaunchInteractionLookup;
  launches: Pick<FactoryFloorLaunchRepository, 'findByStateId' | 'consume'>;
  oauth: Pick<
    FactoryFloorOAuthRepository,
    'begin' | 'findByStateId' | 'verifyAndConsume'
  >;
  resolveMember(
    guildId: string,
    userId: string,
  ): Promise<ActivityMemberResolution | undefined>;
  factoryFloor: Pick<FactoryFloorServiceClient, 'createOrJoinActivitySession'>;
}

export interface ActivityBootstrapService {
  startOAuth(input: StartActivityOAuthInput): Promise<StartActivityOAuthResponse>;
  bootstrap(input: BootstrapActivityInput): Promise<BootstrapActivityResponse>;
}

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ActivityBootstrapError('bad_request', code);
  return normalized;
}

function validateConfiguration(dependencies: ActivityBootstrapDependencies): void {
  required(dependencies.applicationId, 'activity_application_id_required');
  if (dependencies.oauthScopes.length === 0) {
    throw new ActivityBootstrapError('bad_request', 'oauth_scopes_required');
  }
  if (!Number.isSafeInteger(dependencies.oauthTtlMs) || dependencies.oauthTtlMs <= 0) {
    throw new ActivityBootstrapError('bad_request', 'oauth_ttl_invalid');
  }
}

function launchContext(launch: FactoryFloorLaunchRecord): FactoryFloorLaunchContext {
  return {
    applicationId: launch.applicationId,
    installationType: launch.installationType,
    installationOwnerId: launch.installationOwnerId,
    guildId: launch.guildId,
    channelId: launch.channelId,
    threadId: launch.threadId,
    principalId: launch.principalId,
    projectName: launch.projectName,
    factoryFloorProjectId: launch.factoryFloorProjectId,
    surfaceId: launch.surfaceId,
    runId: launch.runId,
    contextKind: launch.contextKind,
  };
}

function currentLaunch(
  launch: FactoryFloorLaunchRecord | undefined,
  now: number,
): FactoryFloorLaunchRecord {
  if (!launch) throw new ActivityBootstrapError('not_found', 'activity_launch_not_found');
  if (launch.consumedAt !== undefined || launch.invalidatedAt !== undefined) {
    throw new ActivityBootstrapError('conflict', 'launch_state_invalid');
  }
  if (launch.expiresAt <= now) {
    throw new ActivityBootstrapError('expired', 'launch_state_expired');
  }
  return launch;
}

async function getActivityInstance(
  dependencies: ActivityBootstrapDependencies,
  instanceId: string,
): Promise<DiscordActivityInstance> {
  try {
    return await dependencies.discord.getActivityInstance(instanceId);
  } catch (error) {
    if (error instanceof DiscordActivityApiError) {
      if (error.kind === 'not_found') {
        throw new ActivityBootstrapError('not_found', 'activity_instance_not_found');
      }
      if (error.kind === 'malformed_response') {
        throw new ActivityBootstrapError('upstream', 'activity_instance_response_invalid');
      }
    }
    throw new ActivityBootstrapError('upstream', 'activity_instance_unavailable');
  }
}

async function exchangeOAuth(
  dependencies: ActivityBootstrapDependencies,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<DiscordOAuthToken> {
  try {
    return await dependencies.discord.exchangeAuthorizationCode(input);
  } catch (error) {
    if (
      error instanceof DiscordActivityApiError
      && (error.kind === 'unauthorized' || error.status === 400)
    ) {
      throw new ActivityBootstrapError('unauthorized', 'oauth_exchange_failed');
    }
    throw new ActivityBootstrapError('upstream', 'oauth_exchange_unavailable');
  }
}

async function currentOAuthUser(
  dependencies: ActivityBootstrapDependencies,
  accessToken: string,
): Promise<{ id: string }> {
  try {
    return await dependencies.discord.getCurrentUser(accessToken);
  } catch {
    throw new ActivityBootstrapError('upstream', 'oauth_identity_unavailable');
  }
}

async function validateInstanceContext(
  dependencies: ActivityBootstrapDependencies,
  instance: DiscordActivityInstance,
  launch: FactoryFloorLaunchRecord,
): Promise<void> {
  if (
    instance.applicationId !== dependencies.applicationId
    || launch.applicationId !== dependencies.applicationId
  ) {
    throw new ActivityBootstrapError('forbidden', 'activity_application_mismatch');
  }
  if (instance.launchId !== launch.interactionId) {
    throw new ActivityBootstrapError('forbidden', 'activity_launch_mismatch');
  }
  const expectedChannelId = launch.threadId ?? launch.channelId;
  if (
    instance.location.kind !== 'gc'
    || instance.location.guildId !== launch.guildId
    || instance.location.channelId !== expectedChannelId
  ) {
    throw new ActivityBootstrapError('forbidden', 'activity_location_mismatch');
  }
  if (!instance.users.includes(launch.principalId)) {
    throw new ActivityBootstrapError('forbidden', 'activity_principal_not_present');
  }
  const member = await dependencies.resolveMember(launch.guildId, launch.principalId);
  if (!member || member.userId !== launch.principalId) {
    throw new ActivityBootstrapError('unauthorized', 'activity_member_unavailable');
  }
  if (!member.authorized) {
    throw new ActivityBootstrapError('forbidden', 'activity_not_authorized');
  }
}

function verifyScopes(token: DiscordOAuthToken, scopes: readonly string[]): void {
  const received = new Set(token.scope.split(/\s+/).filter(Boolean));
  if (scopes.some(scope => !received.has(scope))) {
    throw new ActivityBootstrapError('forbidden', 'oauth_scope_mismatch');
  }
}

function verifyPendingOAuth(
  dependencies: ActivityBootstrapDependencies,
  stateId: string,
  instanceId: string,
  codeVerifier: string,
  now: number,
): void {
  const attempt = dependencies.oauth.findByStateId(stateId);
  const expectedChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  if (
    !attempt
    || attempt.instanceId !== instanceId
    || attempt.consumedAt !== undefined
    || attempt.expiresAt <= now
    || attempt.codeChallenge !== expectedChallenge
  ) {
    throw new ActivityBootstrapError('conflict', 'oauth_state_invalid');
  }
}

export function createActivityBootstrapService(
  dependencies: ActivityBootstrapDependencies,
): ActivityBootstrapService {
  validateConfiguration(dependencies);
  const now = dependencies.now ?? Date.now;
  const adapter = dependencies.adapter?.trim() || 'discord-agent';
  const allowedRedirects = dependencies.allowedRedirectUris
    ? new Set(dependencies.allowedRedirectUris.map(uri => uri.trim()).filter(Boolean))
    : undefined;

  return {
    async startOAuth(input) {
      const instanceId = required(input.instanceId, 'activity_instance_id_required');
      const codeChallenge = required(input.codeChallenge, 'oauth_code_challenge_required');
      if (!CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
        throw new ActivityBootstrapError('bad_request', 'oauth_code_challenge_invalid');
      }
      const at = now();
      const instance = await getActivityInstance(dependencies, instanceId);
      const launch = currentLaunch(
        dependencies.launchLookup.findByInteractionId(instance.launchId),
        at,
      );
      await validateInstanceContext(dependencies, instance, launch);
      const expiresAt = Math.min(launch.expiresAt, at + dependencies.oauthTtlMs);
      let attempt;
      try {
        attempt = dependencies.oauth.begin({
          stateId: launch.stateId,
          instanceId: instance.instanceId,
          codeChallenge,
          createdAt: at,
          expiresAt,
        });
      } catch (error) {
        if (error instanceof FactoryFloorOAuthConflictError) {
          throw new ActivityBootstrapError('conflict', 'oauth_state_invalid');
        }
        throw new ActivityBootstrapError('upstream', 'oauth_state_unavailable');
      }
      return {
        state: attempt.stateId,
        clientId: dependencies.applicationId,
        scopes: [...dependencies.oauthScopes],
        codeChallengeMethod: 'S256',
        expiresAt: attempt.expiresAt,
      };
    },

    async bootstrap(input) {
      const stateId = required(input.state, 'oauth_state_required');
      const instanceId = required(input.instanceId, 'activity_instance_id_required');
      const redirectUri = required(input.redirectUri, 'oauth_redirect_uri_required');
      if (allowedRedirects && !allowedRedirects.has(redirectUri)) {
        throw new ActivityBootstrapError('forbidden', 'oauth_redirect_uri_mismatch');
      }
      const codeVerifier = required(input.codeVerifier, 'oauth_code_verifier_required');
      if (!CODE_VERIFIER_PATTERN.test(codeVerifier)) {
        throw new ActivityBootstrapError('bad_request', 'oauth_code_verifier_invalid');
      }
      const at = now();
      const launch = currentLaunch(dependencies.launches.findByStateId(stateId), at);
      verifyPendingOAuth(dependencies, stateId, instanceId, codeVerifier, at);
      const instance = await getActivityInstance(dependencies, instanceId);
      await validateInstanceContext(dependencies, instance, launch);

      const token = await exchangeOAuth(dependencies, {
        code: required(input.code, 'oauth_authorization_code_required'),
        codeVerifier,
        redirectUri,
      });
      verifyScopes(token, dependencies.oauthScopes);
      const user = await currentOAuthUser(dependencies, token.accessToken);
      if (user.id !== launch.principalId) {
        throw new ActivityBootstrapError('forbidden', 'oauth_principal_mismatch');
      }

      const oauthAttempt = dependencies.oauth.verifyAndConsume({
        stateId,
        instanceId,
        codeVerifier,
        now: at,
      });
      if (!oauthAttempt) {
        throw new ActivityBootstrapError('conflict', 'oauth_state_invalid');
      }
      const consumedLaunch = dependencies.launches.consume({
        stateId,
        now: at,
        expected: launchContext(launch),
      });
      if (!consumedLaunch) {
        throw new ActivityBootstrapError('conflict', 'launch_state_invalid');
      }

      let factoryFloor: ActivitySessionResponse;
      try {
        factoryFloor = await dependencies.factoryFloor.createOrJoinActivitySession({
          applicationId: launch.applicationId,
          instanceId: instance.instanceId,
          installationId: launch.installationOwnerId,
          guildId: launch.guildId,
          channelId: launch.channelId,
          threadId: launch.threadId,
          launchId: instance.launchId,
          principalId: launch.principalId,
          adapter,
          boundRunId: launch.runId,
        });
      } catch {
        throw new ActivityBootstrapError('upstream', 'factory_floor_session_unavailable');
      }

      return {
        discord: token,
        factoryFloor,
        context: {
          kind: launch.contextKind,
          projectId: launch.factoryFloorProjectId,
          ...(launch.runId ? { runId: launch.runId } : {}),
        },
      };
    },
  };
}

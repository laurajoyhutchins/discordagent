import type { DatabaseHandle } from '../db/database.js';
import { redactSensitiveText } from '../utils/redaction.js';

export type FactoryFloorLaunchContextKind = 'project' | 'run';
export type FactoryFloorLaunchInstallationType = 'guild';

export interface FactoryFloorLaunchContext {
  applicationId: string;
  installationType: FactoryFloorLaunchInstallationType;
  installationOwnerId: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  principalId: string;
  projectName: string;
  factoryFloorProjectId: string;
  surfaceId?: string;
  runId?: string;
  contextKind: FactoryFloorLaunchContextKind;
}

export interface FactoryFloorLaunchRecord extends FactoryFloorLaunchContext {
  stateId: string;
  interactionId: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
  invalidatedAt?: number;
  invalidationReason?: string;
}

export interface CreateFactoryFloorLaunchInput extends FactoryFloorLaunchContext {
  stateId: string;
  interactionId: string;
  createdAt?: number;
  expiresAt: number;
}

export interface ConsumeFactoryFloorLaunchInput {
  stateId: string;
  now: number;
  expected: FactoryFloorLaunchContext;
}

export interface FactoryFloorLaunchRepository {
  create(input: CreateFactoryFloorLaunchInput): FactoryFloorLaunchRecord;
  findByStateId(stateId: string): FactoryFloorLaunchRecord | undefined;
  consume(input: ConsumeFactoryFloorLaunchInput): FactoryFloorLaunchRecord | undefined;
  invalidate(
    stateId: string,
    reason: string,
    invalidatedAt?: number,
  ): FactoryFloorLaunchRecord | undefined;
  cleanup(now?: number): number;
}

export class FactoryFloorLaunchConflictError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FactoryFloorLaunchConflictError';
  }
}

interface NormalizedCreateLaunchInput extends FactoryFloorLaunchContext {
  stateId: string;
  interactionId: string;
  createdAt: number;
  expiresAt: number;
  localProjectId: string;
}

interface LaunchRow {
  state_id: string;
  interaction_id: string;
  application_id: string;
  installation_type: FactoryFloorLaunchInstallationType;
  installation_owner_id: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  principal_id: string;
  local_project_id: string;
  project_name: string;
  factory_floor_project_id: string;
  surface_id: string | null;
  run_id: string | null;
  context_kind: FactoryFloorLaunchContextKind;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface ProjectBindingRow {
  local_project_id: string;
  factory_floor_project_id: string;
  guild_id: string;
  retired_at: number | null;
}

interface SurfaceRow {
  id: string;
  local_project_id: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  retired_at: number | null;
}

interface RunRow {
  run_id: string;
  local_project_id: string;
  surface_id: string;
  retired_at: number | null;
}

const SELECT_LAUNCH = `
  SELECT launch.*, project.name AS project_name
  FROM factory_floor_launch_states launch
  JOIN projects project ON project.id = launch.local_project_id
`;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function optional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function timestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field}_invalid`);
  return value;
}

function mapLaunch(row: LaunchRow): FactoryFloorLaunchRecord {
  return {
    stateId: row.state_id,
    interactionId: row.interaction_id,
    applicationId: row.application_id,
    installationType: row.installation_type,
    installationOwnerId: row.installation_owner_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    threadId: row.thread_id ?? undefined,
    principalId: row.principal_id,
    projectName: row.project_name,
    factoryFloorProjectId: row.factory_floor_project_id,
    surfaceId: row.surface_id ?? undefined,
    runId: row.run_id ?? undefined,
    contextKind: row.context_kind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? undefined,
    invalidatedAt: row.invalidated_at ?? undefined,
    invalidationReason: row.invalidation_reason ?? undefined,
  };
}

function sameTrustedContext(row: LaunchRow, input: NormalizedCreateLaunchInput): boolean {
  return row.interaction_id === input.interactionId
    && row.application_id === input.applicationId
    && row.installation_type === input.installationType
    && row.installation_owner_id === input.installationOwnerId
    && row.guild_id === input.guildId
    && row.channel_id === input.channelId
    && row.thread_id === (input.threadId ?? null)
    && row.principal_id === input.principalId
    && row.project_name.toLowerCase() === input.projectName.toLowerCase()
    && row.factory_floor_project_id === input.factoryFloorProjectId
    && row.surface_id === (input.surfaceId ?? null)
    && row.run_id === (input.runId ?? null)
    && row.context_kind === input.contextKind;
}

export function createFactoryFloorLaunchRepository(
  db: DatabaseHandle,
): FactoryFloorLaunchRepository {
  const selectByState = db.raw.prepare(`${SELECT_LAUNCH} WHERE launch.state_id = ?`);
  const selectByInteraction = db.raw.prepare(
    `${SELECT_LAUNCH} WHERE launch.interaction_id = ?`,
  );
  const selectProject = db.raw.prepare(`
    SELECT id, name FROM projects
    WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
  `);
  const selectProjectBinding = db.raw.prepare(`
    SELECT local_project_id, factory_floor_project_id, guild_id, retired_at
    FROM factory_floor_project_bindings WHERE local_project_id = ?
  `);
  const selectSurface = db.raw.prepare(`
    SELECT id, local_project_id, guild_id, channel_id, thread_id, retired_at
    FROM factory_floor_surface_bindings WHERE id = ?
  `);
  const selectRun = db.raw.prepare(`
    SELECT run_id, local_project_id, surface_id, retired_at
    FROM factory_floor_run_bindings WHERE run_id = ?
  `);

  function findByStateId(stateId: string): FactoryFloorLaunchRecord | undefined {
    const row = selectByState.get(required(stateId, 'state_id')) as LaunchRow | undefined;
    return row ? mapLaunch(row) : undefined;
  }

  function validateInput(
    input: CreateFactoryFloorLaunchInput,
  ): NormalizedCreateLaunchInput {
    const createdAt = timestamp(input.createdAt ?? Date.now(), 'created_at');
    const expiresAt = timestamp(input.expiresAt, 'expires_at');
    if (expiresAt <= createdAt) throw new Error('launch_expiry_invalid');
    if (input.installationType !== 'guild') throw new Error('installation_type_invalid');

    const stateId = required(input.stateId, 'state_id');
    const interactionId = required(input.interactionId, 'interaction_id');
    const applicationId = required(input.applicationId, 'application_id');
    const installationOwnerId = required(
      input.installationOwnerId,
      'installation_owner_id',
    );
    const guildId = required(input.guildId, 'guild_id');
    const channelId = required(input.channelId, 'channel_id');
    const threadId = optional(input.threadId) ?? undefined;
    const principalId = required(input.principalId, 'principal_id');
    const projectName = required(input.projectName, 'project_name');
    const factoryFloorProjectId = required(
      input.factoryFloorProjectId,
      'factory_floor_project_id',
    );
    const surfaceId = optional(input.surfaceId) ?? undefined;
    const runId = optional(input.runId) ?? undefined;
    const contextKind = input.contextKind;

    if (
      (contextKind === 'project' && (surfaceId !== undefined || runId !== undefined))
      || (contextKind === 'run' && (surfaceId === undefined || runId === undefined))
    ) {
      throw new Error('launch_context_invalid');
    }

    const project = selectProject.get(projectName) as ProjectRow | undefined;
    if (!project) throw new Error('project_not_found');
    const binding = selectProjectBinding.get(project.id) as ProjectBindingRow | undefined;
    if (
      !binding
      || binding.retired_at !== null
      || binding.factory_floor_project_id !== factoryFloorProjectId
      || binding.guild_id !== guildId
      || binding.guild_id !== installationOwnerId
    ) {
      throw new FactoryFloorLaunchConflictError('project_binding_mismatch');
    }

    if (contextKind === 'run') {
      const surface = selectSurface.get(surfaceId) as SurfaceRow | undefined;
      if (
        !surface
        || surface.retired_at !== null
        || surface.local_project_id !== project.id
        || surface.guild_id !== guildId
        || surface.channel_id !== channelId
        || (threadId !== undefined && surface.thread_id !== threadId)
      ) {
        throw new FactoryFloorLaunchConflictError('surface_binding_mismatch');
      }
      const run = selectRun.get(runId) as RunRow | undefined;
      if (
        !run
        || run.retired_at !== null
        || run.local_project_id !== project.id
        || run.surface_id !== surfaceId
      ) {
        throw new FactoryFloorLaunchConflictError('run_binding_mismatch');
      }
    }

    return {
      stateId,
      interactionId,
      applicationId,
      installationType: 'guild',
      installationOwnerId,
      guildId,
      channelId,
      threadId,
      principalId,
      projectName,
      factoryFloorProjectId,
      surfaceId,
      runId,
      contextKind,
      createdAt,
      expiresAt,
      localProjectId: project.id,
    };
  }

  return {
    create(input) {
      const normalized = validateInput(input);
      const existing = selectByInteraction.get(normalized.interactionId) as
        | LaunchRow
        | undefined;
      if (existing) {
        if (sameTrustedContext(existing, normalized)) return mapLaunch(existing);
        throw new FactoryFloorLaunchConflictError('launch_interaction_conflict');
      }

      try {
        db.raw.prepare(`
          INSERT INTO factory_floor_launch_states (
            state_id, interaction_id, application_id, installation_type,
            installation_owner_id, guild_id, channel_id, thread_id,
            principal_id, local_project_id, factory_floor_project_id,
            surface_id, run_id, context_kind, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalized.stateId,
          normalized.interactionId,
          normalized.applicationId,
          normalized.installationType,
          normalized.installationOwnerId,
          normalized.guildId,
          normalized.channelId,
          normalized.threadId ?? null,
          normalized.principalId,
          normalized.localProjectId,
          normalized.factoryFloorProjectId,
          normalized.surfaceId ?? null,
          normalized.runId ?? null,
          normalized.contextKind,
          normalized.createdAt,
          normalized.expiresAt,
        );
      } catch (error) {
        if (
          error instanceof Error
          && /factory_floor_launch_states\.state_id|UNIQUE constraint failed: factory_floor_launch_states\.state_id/i
            .test(error.message)
        ) {
          throw new FactoryFloorLaunchConflictError('launch_state_conflict');
        }
        throw error;
      }
      return findByStateId(normalized.stateId)!;
    },

    findByStateId,

    consume(input) {
      const expected = input.expected;
      const consumedAt = timestamp(input.now, 'consumed_at');
      const result = db.raw.prepare(`
        UPDATE factory_floor_launch_states
        SET consumed_at = ?
        WHERE state_id = ?
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ?
          AND application_id = ?
          AND installation_type = ?
          AND installation_owner_id = ?
          AND guild_id = ?
          AND channel_id = ?
          AND thread_id IS ?
          AND principal_id = ?
          AND local_project_id = (
            SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
          )
          AND factory_floor_project_id = ?
          AND surface_id IS ?
          AND run_id IS ?
          AND context_kind = ?
      `).run(
        consumedAt,
        required(input.stateId, 'state_id'),
        consumedAt,
        required(expected.applicationId, 'application_id'),
        expected.installationType,
        required(expected.installationOwnerId, 'installation_owner_id'),
        required(expected.guildId, 'guild_id'),
        required(expected.channelId, 'channel_id'),
        optional(expected.threadId),
        required(expected.principalId, 'principal_id'),
        required(expected.projectName, 'project_name'),
        required(expected.factoryFloorProjectId, 'factory_floor_project_id'),
        optional(expected.surfaceId),
        optional(expected.runId),
        expected.contextKind,
      );
      return result.changes === 1 ? findByStateId(input.stateId) : undefined;
    },

    invalidate(stateId, reason, invalidatedAt = Date.now()) {
      const normalizedId = required(stateId, 'state_id');
      const at = timestamp(invalidatedAt, 'invalidated_at');
      const result = db.raw.prepare(`
        UPDATE factory_floor_launch_states
        SET invalidated_at = ?, invalidation_reason = ?
        WHERE state_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL
      `).run(at, redactSensitiveText(required(reason, 'invalidation_reason')), normalizedId);
      return result.changes === 1 ? findByStateId(normalizedId) : undefined;
    },

    cleanup(now = Date.now()) {
      const result = db.raw.prepare(`
        DELETE FROM factory_floor_launch_states
        WHERE expires_at <= ? OR consumed_at IS NOT NULL OR invalidated_at IS NOT NULL
      `).run(timestamp(now, 'cleanup_at'));
      return result.changes;
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '../db/database.js';
import type {
  FactoryFloorProjectBinding,
  FactoryFloorRunBinding,
  FactoryFloorSurfaceBinding,
} from '../repositories/factoryFloorBindingRepository.js';
import type {
  CreateFactoryFloorLaunchInput,
  FactoryFloorLaunchRepository,
} from '../repositories/factoryFloorLaunchRepository.js';
import type { Project } from '../types.js';

export interface TrustedActivityLaunchRequest {
  readonly interactionId: string;
  readonly applicationId: string;
  readonly installationType: 'guild' | 'user';
  readonly installationOwnerId: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly principalId: string;
  readonly authorized: boolean;
}

export interface FactoryFloorActivityLaunchBindingLookup {
  findProjectByName(projectName: string): FactoryFloorProjectBinding | undefined;
  findSurfaceByThread(
    guildId: string,
    channelId: string,
    threadId: string,
  ): FactoryFloorSurfaceBinding | undefined;
  findActiveRunBySurface(surfaceId: string): FactoryFloorRunBinding | undefined;
  listActiveRunsByProject(projectName: string): FactoryFloorRunBinding[];
}

export interface FactoryFloorActivityLaunchDependencies {
  readonly expectedApplicationId: string;
  readonly findProjectByChannelId: (channelId: string) => Project | undefined;
  readonly bindings: FactoryFloorActivityLaunchBindingLookup;
  readonly launches: Pick<FactoryFloorLaunchRepository, 'create' | 'invalidate'>;
  readonly now?: () => number;
  readonly generateStateId?: () => string;
  readonly launchTtlMs?: number;
}

export type FactoryFloorActivityLaunchFailureCode =
  | 'not_authorized'
  | 'application_mismatch'
  | 'installation_mismatch'
  | 'guild_mismatch'
  | 'project_unavailable'
  | 'project_unbound'
  | 'binding_mismatch'
  | 'surface_unbound'
  | 'run_unavailable'
  | 'ambiguous_run';

export interface FactoryFloorActivityLaunchFailure {
  readonly ok: false;
  readonly code: FactoryFloorActivityLaunchFailureCode;
  readonly message: string;
}

export interface FactoryFloorActivityLaunchSuccess {
  readonly ok: true;
  readonly stateId: string;
  readonly contextKind: 'project' | 'run';
  readonly projectName: string;
  readonly runId?: string;
}

export type FactoryFloorActivityLaunchResult =
  | FactoryFloorActivityLaunchFailure
  | FactoryFloorActivityLaunchSuccess;

export interface FactoryFloorActivityLaunchService {
  prepare(request: TrustedActivityLaunchRequest): Promise<FactoryFloorActivityLaunchResult>;
  invalidate(stateId: string, reason: string): void;
}

const DEFAULT_LAUNCH_TTL_MS = 2 * 60_000;

const FAILURE_MESSAGES: Record<FactoryFloorActivityLaunchFailureCode, string> = {
  not_authorized: 'You are not authorized to open Factory Floor from this server.',
  application_mismatch: 'This Activity launch does not belong to this Discord application.',
  installation_mismatch: 'Factory Floor can only be opened from this server installation.',
  guild_mismatch: 'This Activity launch does not match the configured Discord server.',
  project_unavailable: 'This channel is not a registered project surface.',
  project_unbound: 'This project is not connected to Factory Floor.',
  binding_mismatch: 'The Factory Floor project binding does not match this Discord server.',
  surface_unbound: 'This task thread is not connected to a Factory Floor run.',
  run_unavailable: 'This task thread has no active Factory Floor run to open.',
  ambiguous_run: 'More than one Factory Floor run is active here. Open the specific task thread first.',
};

function failure(code: FactoryFloorActivityLaunchFailureCode): FactoryFloorActivityLaunchFailure {
  return { ok: false, code, message: FAILURE_MESSAGES[code] };
}

interface ProjectBindingRow {
  project_name: string;
  factory_floor_project_id: string;
  guild_id: string;
  created_at: number;
  updated_at: number;
}

interface SurfaceBindingRow {
  id: string;
  project_name: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  created_at: number;
  updated_at: number;
}

interface RunBindingRow {
  run_id: string;
  project_name: string;
  surface_id: string;
  created_at: number;
  updated_at: number;
}

function mapProjectBinding(row: ProjectBindingRow): FactoryFloorProjectBinding {
  return {
    projectName: row.project_name,
    factoryFloorProjectId: row.factory_floor_project_id,
    guildId: row.guild_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSurfaceBinding(row: SurfaceBindingRow): FactoryFloorSurfaceBinding {
  return {
    id: row.id,
    projectName: row.project_name,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunBinding(row: RunBindingRow): FactoryFloorRunBinding {
  return {
    runId: row.run_id,
    projectName: row.project_name,
    surfaceId: row.surface_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createFactoryFloorActivityLaunchBindingLookup(
  db: DatabaseHandle,
): FactoryFloorActivityLaunchBindingLookup {
  return {
    findProjectByName(projectName) {
      const row = db.raw.prepare(`
        SELECT project.name AS project_name,
               binding.factory_floor_project_id,
               binding.guild_id,
               binding.created_at,
               binding.updated_at
        FROM factory_floor_project_bindings binding
        JOIN projects project ON project.id = binding.local_project_id
        WHERE project.name = ? COLLATE NOCASE
          AND project.archived_at IS NULL
          AND binding.retired_at IS NULL
      `).get(projectName.trim()) as ProjectBindingRow | undefined;
      return row ? mapProjectBinding(row) : undefined;
    },

    findSurfaceByThread(guildId, channelId, threadId) {
      const row = db.raw.prepare(`
        SELECT binding.id,
               project.name AS project_name,
               binding.guild_id,
               binding.channel_id,
               binding.thread_id,
               binding.created_at,
               binding.updated_at
        FROM factory_floor_surface_bindings binding
        JOIN projects project ON project.id = binding.local_project_id
        WHERE binding.guild_id = ?
          AND binding.channel_id = ?
          AND binding.thread_id = ?
          AND binding.retired_at IS NULL
          AND project.archived_at IS NULL
      `).get(guildId.trim(), channelId.trim(), threadId.trim()) as
        | SurfaceBindingRow
        | undefined;
      return row ? mapSurfaceBinding(row) : undefined;
    },

    findActiveRunBySurface(surfaceId) {
      const row = db.raw.prepare(`
        SELECT run.run_id,
               project.name AS project_name,
               run.surface_id,
               run.created_at,
               run.updated_at
        FROM factory_floor_run_bindings run
        JOIN projects project ON project.id = run.local_project_id
        JOIN factory_floor_surface_bindings surface ON surface.id = run.surface_id
        WHERE run.surface_id = ?
          AND run.retired_at IS NULL
          AND surface.retired_at IS NULL
          AND project.archived_at IS NULL
      `).get(surfaceId.trim()) as RunBindingRow | undefined;
      return row ? mapRunBinding(row) : undefined;
    },

    listActiveRunsByProject(projectName) {
      const rows = db.raw.prepare(`
        SELECT run.run_id,
               project.name AS project_name,
               run.surface_id,
               run.created_at,
               run.updated_at
        FROM factory_floor_run_bindings run
        JOIN projects project ON project.id = run.local_project_id
        JOIN factory_floor_surface_bindings surface ON surface.id = run.surface_id
        WHERE project.name = ? COLLATE NOCASE
          AND project.archived_at IS NULL
          AND run.retired_at IS NULL
          AND surface.retired_at IS NULL
        ORDER BY run.created_at, run.run_id
      `).all(projectName.trim()) as RunBindingRow[];
      return rows.map(mapRunBinding);
    },
  };
}

export function createFactoryFloorActivityLaunchService(
  dependencies: FactoryFloorActivityLaunchDependencies,
): FactoryFloorActivityLaunchService {
  const now = dependencies.now ?? Date.now;
  const generateStateId = dependencies.generateStateId ?? randomUUID;
  const launchTtlMs = dependencies.launchTtlMs ?? DEFAULT_LAUNCH_TTL_MS;
  if (!Number.isSafeInteger(launchTtlMs) || launchTtlMs <= 0) {
    throw new Error('factory_floor_launch_ttl_invalid');
  }

  return {
    async prepare(request) {
      if (!request.authorized) return failure('not_authorized');
      if (request.applicationId !== dependencies.expectedApplicationId) {
        return failure('application_mismatch');
      }
      if (
        request.installationType !== 'guild'
        || request.installationOwnerId !== request.guildId
      ) {
        return failure('installation_mismatch');
      }

      const project = dependencies.findProjectByChannelId(request.channelId);
      if (!project) return failure('project_unavailable');
      const projectBinding = dependencies.bindings.findProjectByName(project.name);
      if (!projectBinding) return failure('project_unbound');
      if (projectBinding.guildId !== request.guildId) return failure('binding_mismatch');

      let contextKind: 'project' | 'run' = 'project';
      let surfaceId: string | undefined;
      let runId: string | undefined;

      if (request.threadId) {
        const surface = dependencies.bindings.findSurfaceByThread(
          request.guildId,
          request.channelId,
          request.threadId,
        );
        if (!surface || surface.projectName.toLowerCase() !== project.name.toLowerCase()) {
          return failure('surface_unbound');
        }
        const run = dependencies.bindings.findActiveRunBySurface(surface.id);
        if (!run || run.projectName.toLowerCase() !== project.name.toLowerCase()) {
          return failure('run_unavailable');
        }
        contextKind = 'run';
        surfaceId = surface.id;
        runId = run.runId;
      } else {
        const runs = dependencies.bindings.listActiveRunsByProject(project.name);
        if (runs.length > 1) return failure('ambiguous_run');
        if (runs.length === 1) {
          contextKind = 'run';
          surfaceId = runs[0]!.surfaceId;
          runId = runs[0]!.runId;
        }
      }

      const createdAt = now();
      const stateId = generateStateId();
      const registration: CreateFactoryFloorLaunchInput = {
        stateId,
        interactionId: request.interactionId,
        applicationId: request.applicationId,
        installationType: 'guild',
        installationOwnerId: request.installationOwnerId,
        guildId: request.guildId,
        channelId: request.channelId,
        threadId: request.threadId,
        principalId: request.principalId,
        projectName: project.name,
        factoryFloorProjectId: projectBinding.factoryFloorProjectId,
        surfaceId,
        runId,
        contextKind,
        createdAt,
        expiresAt: createdAt + launchTtlMs,
      };
      dependencies.launches.create(registration);

      return {
        ok: true,
        stateId,
        contextKind,
        projectName: project.name,
        ...(runId ? { runId } : {}),
      };
    },

    invalidate(stateId, reason) {
      dependencies.launches.invalidate(stateId, reason, now());
    },
  };
}

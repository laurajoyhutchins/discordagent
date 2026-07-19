import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '../db/database.js';
import type { ServiceAuthNonceStore } from '../factoryFloor/serviceAuth.js';

export class FactoryFloorBindingConflictError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FactoryFloorBindingConflictError';
  }
}

export interface FactoryFloorProjectBinding {
  projectName: string;
  factoryFloorProjectId: string;
  guildId: string;
  createdAt: number;
  updatedAt: number;
  retiredAt?: number;
}

export interface FactoryFloorSurfaceBinding {
  id: string;
  projectName: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  messageId?: string;
  activityInstanceId?: string;
  createdAt: number;
  updatedAt: number;
  retiredAt?: number;
}

export interface FactoryFloorRunBinding {
  runId: string;
  projectName: string;
  surfaceId: string;
  createdAt: number;
  updatedAt: number;
  retiredAt?: number;
}

export interface BindProjectInput {
  projectName: string;
  factoryFloorProjectId: string;
  guildId: string;
}

export interface BindSurfaceInput {
  projectName: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  messageId?: string;
  activityInstanceId?: string;
}

export interface BindRunInput {
  projectName: string;
  surfaceId: string;
  runId: string;
}

export interface FactoryFloorBindingRepository {
  bindProject(input: BindProjectInput): FactoryFloorProjectBinding;
  findProjectByName(projectName: string): FactoryFloorProjectBinding | undefined;
  findProjectByFactoryFloorId(factoryFloorProjectId: string): FactoryFloorProjectBinding | undefined;
  bindSurface(input: BindSurfaceInput): FactoryFloorSurfaceBinding;
  findSurfaceById(id: string): FactoryFloorSurfaceBinding | undefined;
  findSurfaceByActivityInstance(activityInstanceId: string): FactoryFloorSurfaceBinding | undefined;
  bindRun(input: BindRunInput): FactoryFloorRunBinding;
  findRun(runId: string): FactoryFloorRunBinding | undefined;
  retireProject(projectName: string): boolean;
  retireSurface(id: string): boolean;
  retireRun(runId: string): boolean;
}

interface LocalProjectRow {
  id: string;
  name: string;
}

interface ProjectBindingRow {
  local_project_id: string;
  project_name: string;
  factory_floor_project_id: string;
  guild_id: string;
  created_at: number;
  updated_at: number;
  retired_at: number | null;
}

interface SurfaceBindingRow {
  id: string;
  local_project_id: string;
  project_name: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  message_id: string | null;
  activity_instance_id: string | null;
  created_at: number;
  updated_at: number;
  retired_at: number | null;
}

interface RunBindingRow {
  run_id: string;
  local_project_id: string;
  project_name: string;
  surface_id: string;
  created_at: number;
  updated_at: number;
  retired_at: number | null;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapProject(row: ProjectBindingRow): FactoryFloorProjectBinding {
  return {
    projectName: row.project_name,
    factoryFloorProjectId: row.factory_floor_project_id,
    guildId: row.guild_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  };
}

function mapSurface(row: SurfaceBindingRow): FactoryFloorSurfaceBinding {
  return {
    id: row.id,
    projectName: row.project_name,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.activity_instance_id
      ? { activityInstanceId: row.activity_instance_id }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  };
}

function mapRun(row: RunBindingRow): FactoryFloorRunBinding {
  return {
    runId: row.run_id,
    projectName: row.project_name,
    surfaceId: row.surface_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  };
}

export function createFactoryFloorBindingRepository(
  db: DatabaseHandle,
): FactoryFloorBindingRepository {
  const selectLocalProject = db.raw.prepare(`
    SELECT id, name FROM projects
    WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
  `);
  const selectProjectByLocal = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_project_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.local_project_id = ?
  `);
  const selectProjectByFactory = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_project_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.factory_floor_project_id = ?
  `);
  const selectSurfaceById = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.id = ?
  `);
  const selectSurfaceByActivity = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.activity_instance_id = ?
  `);
  const selectSurfaceByMessage = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.message_id = ?
  `);
  const selectSurfaceByThread = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.guild_id = ? AND binding.channel_id = ? AND binding.thread_id = ?
  `);
  const selectRun = db.raw.prepare(`
    SELECT binding.*, project.name AS project_name
    FROM factory_floor_run_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.run_id = ?
  `);

  function localProject(projectName: string): LocalProjectRow {
    const row = selectLocalProject.get(required(projectName, 'project_name')) as
      | LocalProjectRow
      | undefined;
    if (!row) throw new Error('project_not_found');
    return row;
  }

  function activeProject(projectName: string): ProjectBindingRow {
    const project = localProject(projectName);
    const row = selectProjectByLocal.get(project.id) as ProjectBindingRow | undefined;
    if (!row || row.retired_at !== null) throw new Error('factory_floor_project_not_bound');
    return row;
  }

  return {
    bindProject(input) {
      const project = localProject(input.projectName);
      const factoryFloorProjectId = required(
        input.factoryFloorProjectId,
        'factory_floor_project_id',
      );
      const guildId = required(input.guildId, 'guild_id');
      const existingLocal = selectProjectByLocal.get(project.id) as
        | ProjectBindingRow
        | undefined;
      const existingFactory = selectProjectByFactory.get(factoryFloorProjectId) as
        | ProjectBindingRow
        | undefined;

      if (existingLocal) {
        if (
          existingLocal.factory_floor_project_id !== factoryFloorProjectId ||
          existingLocal.guild_id !== guildId
        ) {
          throw new FactoryFloorBindingConflictError('project_binding_conflict');
        }
        const now = Date.now();
        db.raw.prepare(`
          UPDATE factory_floor_project_bindings
          SET retired_at = NULL, updated_at = ?
          WHERE local_project_id = ?
        `).run(now, project.id);
        return mapProject(selectProjectByLocal.get(project.id) as ProjectBindingRow);
      }

      if (existingFactory && existingFactory.local_project_id !== project.id) {
        throw new FactoryFloorBindingConflictError('factory_floor_project_already_bound');
      }

      const now = Date.now();
      db.raw.prepare(`
        INSERT INTO factory_floor_project_bindings (
          local_project_id, factory_floor_project_id, guild_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(project.id, factoryFloorProjectId, guildId, now, now);
      return mapProject(selectProjectByLocal.get(project.id) as ProjectBindingRow);
    },

    findProjectByName(projectName) {
      const project = selectLocalProject.get(projectName.trim()) as LocalProjectRow | undefined;
      if (!project) return undefined;
      const row = selectProjectByLocal.get(project.id) as ProjectBindingRow | undefined;
      return row && row.retired_at === null ? mapProject(row) : undefined;
    },

    findProjectByFactoryFloorId(factoryFloorProjectId) {
      const row = selectProjectByFactory.get(factoryFloorProjectId.trim()) as
        | ProjectBindingRow
        | undefined;
      return row && row.retired_at === null ? mapProject(row) : undefined;
    },

    bindSurface(input) {
      const projectBinding = activeProject(input.projectName);
      const guildId = required(input.guildId, 'guild_id');
      const channelId = required(input.channelId, 'channel_id');
      const threadId = optional(input.threadId);
      const messageId = optional(input.messageId);
      const activityInstanceId = optional(input.activityInstanceId);
      if (!threadId && !messageId && !activityInstanceId) {
        throw new Error('surface_identity_required');
      }
      if (projectBinding.guild_id !== guildId) {
        throw new FactoryFloorBindingConflictError('surface_guild_mismatch');
      }

      const candidates = [
        activityInstanceId
          ? (selectSurfaceByActivity.get(activityInstanceId) as SurfaceBindingRow | undefined)
          : undefined,
        messageId
          ? (selectSurfaceByMessage.get(messageId) as SurfaceBindingRow | undefined)
          : undefined,
        threadId
          ? (selectSurfaceByThread.get(guildId, channelId, threadId) as SurfaceBindingRow | undefined)
          : undefined,
      ].filter((row): row is SurfaceBindingRow => row !== undefined);
      const candidateIds = new Set(candidates.map(row => row.id));
      if (candidateIds.size > 1) {
        throw new FactoryFloorBindingConflictError('surface_identity_conflict');
      }

      const existing = candidates[0];
      if (existing) {
        if (
          existing.local_project_id !== projectBinding.local_project_id ||
          existing.guild_id !== guildId ||
          existing.channel_id !== channelId ||
          existing.thread_id !== threadId ||
          existing.message_id !== messageId ||
          existing.activity_instance_id !== activityInstanceId
        ) {
          throw new FactoryFloorBindingConflictError('surface_binding_conflict');
        }
        const now = Date.now();
        db.raw.prepare(`
          UPDATE factory_floor_surface_bindings
          SET retired_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(now, existing.id);
        return mapSurface(selectSurfaceById.get(existing.id) as SurfaceBindingRow);
      }

      const id = randomUUID();
      const now = Date.now();
      db.raw.prepare(`
        INSERT INTO factory_floor_surface_bindings (
          id, local_project_id, guild_id, channel_id, thread_id,
          message_id, activity_instance_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectBinding.local_project_id,
        guildId,
        channelId,
        threadId,
        messageId,
        activityInstanceId,
        now,
        now,
      );
      return mapSurface(selectSurfaceById.get(id) as SurfaceBindingRow);
    },

    findSurfaceById(id) {
      const row = selectSurfaceById.get(id.trim()) as SurfaceBindingRow | undefined;
      return row && row.retired_at === null ? mapSurface(row) : undefined;
    },

    findSurfaceByActivityInstance(activityInstanceId) {
      const row = selectSurfaceByActivity.get(activityInstanceId.trim()) as
        | SurfaceBindingRow
        | undefined;
      return row && row.retired_at === null ? mapSurface(row) : undefined;
    },

    bindRun(input) {
      const projectBinding = activeProject(input.projectName);
      const runId = required(input.runId, 'run_id');
      const surfaceId = required(input.surfaceId, 'surface_id');
      const surface = selectSurfaceById.get(surfaceId) as SurfaceBindingRow | undefined;
      if (!surface || surface.retired_at !== null) throw new Error('surface_not_found');
      if (surface.local_project_id !== projectBinding.local_project_id) {
        throw new FactoryFloorBindingConflictError('run_project_mismatch');
      }

      const existing = selectRun.get(runId) as RunBindingRow | undefined;
      if (existing) {
        if (
          existing.local_project_id !== projectBinding.local_project_id ||
          existing.surface_id !== surfaceId
        ) {
          throw new FactoryFloorBindingConflictError('run_binding_conflict');
        }
        const now = Date.now();
        db.raw.prepare(`
          UPDATE factory_floor_run_bindings
          SET retired_at = NULL, updated_at = ?
          WHERE run_id = ?
        `).run(now, runId);
        return mapRun(selectRun.get(runId) as RunBindingRow);
      }

      const activeSurfaceRun = db.raw.prepare(`
        SELECT run_id FROM factory_floor_run_bindings
        WHERE surface_id = ? AND retired_at IS NULL
      `).get(surfaceId) as { run_id: string } | undefined;
      if (activeSurfaceRun) {
        throw new FactoryFloorBindingConflictError('surface_already_bound_to_run');
      }

      const now = Date.now();
      db.raw.prepare(`
        INSERT INTO factory_floor_run_bindings (
          run_id, local_project_id, surface_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(runId, projectBinding.local_project_id, surfaceId, now, now);
      return mapRun(selectRun.get(runId) as RunBindingRow);
    },

    findRun(runId) {
      const row = selectRun.get(runId.trim()) as RunBindingRow | undefined;
      return row && row.retired_at === null ? mapRun(row) : undefined;
    },

    retireProject(projectName) {
      const project = selectLocalProject.get(projectName.trim()) as LocalProjectRow | undefined;
      if (!project) return false;
      const now = Date.now();
      return db.raw.transaction(() => {
        const projectResult = db.raw.prepare(`
          UPDATE factory_floor_project_bindings
          SET retired_at = ?, updated_at = ?
          WHERE local_project_id = ? AND retired_at IS NULL
        `).run(now, now, project.id);
        db.raw.prepare(`
          UPDATE factory_floor_surface_bindings
          SET retired_at = ?, updated_at = ?
          WHERE local_project_id = ? AND retired_at IS NULL
        `).run(now, now, project.id);
        db.raw.prepare(`
          UPDATE factory_floor_run_bindings
          SET retired_at = ?, updated_at = ?
          WHERE local_project_id = ? AND retired_at IS NULL
        `).run(now, now, project.id);
        return projectResult.changes === 1;
      })();
    },

    retireSurface(id) {
      const now = Date.now();
      return db.raw.transaction(() => {
        const result = db.raw.prepare(`
          UPDATE factory_floor_surface_bindings
          SET retired_at = ?, updated_at = ?
          WHERE id = ? AND retired_at IS NULL
        `).run(now, now, id.trim());
        db.raw.prepare(`
          UPDATE factory_floor_run_bindings
          SET retired_at = ?, updated_at = ?
          WHERE surface_id = ? AND retired_at IS NULL
        `).run(now, now, id.trim());
        return result.changes === 1;
      })();
    },

    retireRun(runId) {
      const now = Date.now();
      const result = db.raw.prepare(`
        UPDATE factory_floor_run_bindings
        SET retired_at = ?, updated_at = ?
        WHERE run_id = ? AND retired_at IS NULL
      `).run(now, now, runId.trim());
      return result.changes === 1;
    },
  };
}

export function createFactoryFloorNonceStore(
  db: DatabaseHandle,
  ttlMs = 5 * 60_000,
): ServiceAuthNonceStore {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('factory_floor_nonce_ttl_invalid');
  }

  const consume = db.raw.transaction((keyId: string, nonce: string, now: number) => {
    db.raw.prepare(`
      DELETE FROM factory_floor_service_nonces WHERE expires_at <= ?
    `).run(now);
    const result = db.raw.prepare(`
      INSERT OR IGNORE INTO factory_floor_service_nonces (
        key_id, nonce, consumed_at, expires_at
      ) VALUES (?, ?, ?, ?)
    `).run(keyId, nonce, now, now + ttlMs);
    return result.changes === 1;
  });

  return {
    consumeNonce(keyId, nonce, now) {
      return consume(required(keyId, 'key_id'), required(nonce, 'nonce'), now);
    },
  };
}

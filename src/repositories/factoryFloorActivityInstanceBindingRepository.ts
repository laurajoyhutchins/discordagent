import type { DatabaseHandle } from '../db/database.js';
import {
  FactoryFloorBindingConflictError,
  type FactoryFloorSurfaceBinding,
} from './factoryFloorBindingRepository.js';

export interface FactoryFloorActivityInstanceBindingRepository {
  bind(surfaceId: string, activityInstanceId: string): FactoryFloorSurfaceBinding;
}

interface SurfaceBindingRow {
  id: string;
  project_name: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  message_id: string | null;
  activity_instance_id: string | null;
  created_at: number;
  updated_at: number;
  retired_at: number | null;
  project_archived_at: number | null;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
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

export function createFactoryFloorActivityInstanceBindingRepository(
  db: DatabaseHandle,
): FactoryFloorActivityInstanceBindingRepository {
  const findSurface = db.raw.prepare(`
    SELECT binding.*,
           project.name AS project_name,
           project.archived_at AS project_archived_at
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.id = ?
  `);
  const findActivity = db.raw.prepare(`
    SELECT binding.*,
           project.name AS project_name,
           project.archived_at AS project_archived_at
    FROM factory_floor_surface_bindings binding
    JOIN projects project ON project.id = binding.local_project_id
    WHERE binding.activity_instance_id = ?
  `);
  const attach = db.raw.prepare(`
    UPDATE factory_floor_surface_bindings
    SET activity_instance_id = ?, updated_at = ?
    WHERE id = ? AND retired_at IS NULL
  `);

  return {
    bind(surfaceId, activityInstanceId) {
      const normalizedSurfaceId = required(surfaceId, 'surface_id');
      const normalizedInstanceId = required(activityInstanceId, 'activity_instance_id');
      return db.raw.transaction(() => {
        const surface = findSurface.get(normalizedSurfaceId) as SurfaceBindingRow | undefined;
        if (
          !surface
          || surface.retired_at !== null
          || surface.project_archived_at !== null
        ) {
          throw new Error('surface_not_found');
        }
        if (
          surface.activity_instance_id !== null
          && surface.activity_instance_id !== normalizedInstanceId
        ) {
          throw new FactoryFloorBindingConflictError(
            'surface_activity_instance_conflict',
          );
        }

        const existing = findActivity.get(normalizedInstanceId) as
          | SurfaceBindingRow
          | undefined;
        if (existing && existing.id !== normalizedSurfaceId) {
          throw new FactoryFloorBindingConflictError(
            'activity_instance_already_bound',
          );
        }
        if (surface.activity_instance_id === normalizedInstanceId) {
          return mapSurface(surface);
        }

        const now = Date.now();
        const result = attach.run(normalizedInstanceId, now, normalizedSurfaceId);
        if (result.changes !== 1) throw new Error('surface_not_found');
        return mapSurface(findSurface.get(normalizedSurfaceId) as SurfaceBindingRow);
      })();
    },
  };
}

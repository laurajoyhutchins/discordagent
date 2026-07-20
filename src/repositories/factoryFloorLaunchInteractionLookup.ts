import type { DatabaseHandle } from '../db/database.js';
import {
  createFactoryFloorLaunchRepository,
  type FactoryFloorLaunchRecord,
} from './factoryFloorLaunchRepository.js';

export interface FactoryFloorLaunchInteractionLookup {
  findByInteractionId(interactionId: string): FactoryFloorLaunchRecord | undefined;
}

export function createFactoryFloorLaunchInteractionLookup(
  db: DatabaseHandle,
): FactoryFloorLaunchInteractionLookup {
  const launches = createFactoryFloorLaunchRepository(db);
  const select = db.raw.prepare(`
    SELECT state_id
    FROM factory_floor_launch_states
    WHERE interaction_id = ?
  `);

  return {
    findByInteractionId(interactionId) {
      const normalized = interactionId.trim();
      if (!normalized) throw new Error('interaction_id_required');
      const row = select.get(normalized) as { state_id: string } | undefined;
      return row ? launches.findByStateId(row.state_id) : undefined;
    },
  };
}
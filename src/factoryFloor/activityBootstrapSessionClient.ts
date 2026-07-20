import type {
  FactoryFloorBindingRepository,
} from '../repositories/factoryFloorBindingRepository.js';
import type {
  FactoryFloorActivityInstanceBindingRepository,
} from '../repositories/factoryFloorActivityInstanceBindingRepository.js';
import type {
  ActivitySessionResponse,
  CreateActivitySessionRequest,
  FactoryFloorServiceClient,
} from './client.js';

export interface ActivityBootstrapSessionClientDependencies {
  bindings: Pick<FactoryFloorBindingRepository, 'findRun'>;
  activityInstances: Pick<FactoryFloorActivityInstanceBindingRepository, 'bind'>;
  factoryFloor: Pick<FactoryFloorServiceClient, 'createOrJoinActivitySession'>;
}

export interface ActivityBootstrapSessionClient {
  createOrJoinActivitySession(
    input: CreateActivitySessionRequest,
  ): Promise<ActivitySessionResponse>;
}

export function createActivityBootstrapSessionClient(
  dependencies: ActivityBootstrapSessionClientDependencies,
): ActivityBootstrapSessionClient {
  return {
    async createOrJoinActivitySession(input) {
      if (input.boundRunId) {
        const run = dependencies.bindings.findRun(input.boundRunId);
        if (!run) throw new Error('factory_floor_run_binding_unavailable');
        dependencies.activityInstances.bind(run.surfaceId, input.instanceId);
      }
      return dependencies.factoryFloor.createOrJoinActivitySession(input);
    },
  };
}

import { Routes } from 'discord.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';

export interface FactoryFloorEntryPointCommand {
  readonly name: string;
  readonly description: string;
  readonly type: 4;
  readonly handler: 1;
  readonly integration_types: readonly [0];
  readonly contexts: readonly [0];
}

export interface RemoteActivityCommand {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: number;
  readonly handler?: number;
  readonly integration_types?: readonly number[];
  readonly contexts?: readonly number[];
}

export interface ActivityCommandApi {
  listGlobalCommands(): Promise<readonly RemoteActivityCommand[]>;
  createGlobalCommand(
    command: FactoryFloorEntryPointCommand,
  ): Promise<{ readonly id: string }>;
  editGlobalCommand(
    commandId: string,
    command: FactoryFloorEntryPointCommand,
  ): Promise<{ readonly id: string }>;
  deleteGlobalCommand(commandId: string): Promise<void>;
}

export interface ActivityCommandOwnershipStore {
  getOwnedCommandId(): string | undefined;
  setOwnedCommandId(commandId: string | undefined): void;
}

export interface DiscordActivityCommandRestClient {
  get(route: string): Promise<unknown>;
  post(route: string, options: { body: unknown }): Promise<unknown>;
  patch(route: string, options: { body: unknown }): Promise<unknown>;
  delete(route: string): Promise<unknown>;
}

export type ActivityEntryPointReconciliationResult =
  | { readonly action: 'none'; readonly commandId?: string }
  | { readonly action: 'created' | 'updated' | 'deleted'; readonly commandId: string };

export interface ReconcileFactoryFloorEntryPointOptions {
  readonly enabled: boolean;
  readonly api: ActivityCommandApi;
  readonly ownership: ActivityCommandOwnershipStore;
}

const PRIMARY_ENTRY_POINT = 4;
const OWNED_COMMAND_SETTING = 'factory_floor_entry_point_command_id';

export function desiredFactoryFloorEntryPoint(): FactoryFloorEntryPointCommand {
  return {
    name: 'factory-floor',
    description: 'Open Factory Floor for the current Discord context',
    type: PRIMARY_ENTRY_POINT,
    handler: 1,
    integration_types: [0],
    contexts: [0],
  };
}

export function createDiscordActivityCommandApi(
  rest: DiscordActivityCommandRestClient,
  applicationId: string,
): ActivityCommandApi {
  const normalizedApplicationId = applicationId.trim();
  if (!normalizedApplicationId) throw new Error('discord_application_id_required');

  return {
    async listGlobalCommands() {
      const response = await rest.get(Routes.applicationCommands(normalizedApplicationId));
      if (!Array.isArray(response)) {
        throw new Error('Discord global command response was not an array');
      }
      return response as RemoteActivityCommand[];
    },

    async createGlobalCommand(command) {
      const response = await rest.post(
        Routes.applicationCommands(normalizedApplicationId),
        { body: command },
      ) as { id?: unknown };
      if (typeof response?.id !== 'string' || !response.id) {
        throw new Error('Discord did not return an Activity Entry Point command ID');
      }
      return { id: response.id };
    },

    async editGlobalCommand(commandId, command) {
      const response = await rest.patch(
        Routes.applicationCommand(normalizedApplicationId, commandId),
        { body: command },
      ) as { id?: unknown };
      if (typeof response?.id !== 'string' || !response.id) {
        throw new Error('Discord did not return the updated Activity Entry Point command ID');
      }
      return { id: response.id };
    },

    async deleteGlobalCommand(commandId) {
      await rest.delete(Routes.applicationCommand(normalizedApplicationId, commandId));
    },
  };
}

export function createActivityCommandOwnershipStore(
  settings: Pick<SettingsRepository, 'get' | 'set'>,
): ActivityCommandOwnershipStore {
  return {
    getOwnedCommandId() {
      return settings.get(OWNED_COMMAND_SETTING) || undefined;
    },
    setOwnedCommandId(commandId) {
      settings.set(OWNED_COMMAND_SETTING, commandId ?? '');
    },
  };
}

function sameNumbers(
  left: readonly number[] | undefined,
  right: readonly number[],
): boolean {
  return left?.length === right.length
    && left.every((value, index) => value === right[index]);
}

function matchesDesired(
  command: RemoteActivityCommand,
  desired: FactoryFloorEntryPointCommand,
): boolean {
  return command.name === desired.name
    && command.description === desired.description
    && command.type === desired.type
    && command.handler === desired.handler
    && sameNumbers(command.integration_types, desired.integration_types)
    && sameNumbers(command.contexts, desired.contexts);
}

export async function reconcileFactoryFloorEntryPoint(
  options: ReconcileFactoryFloorEntryPointOptions,
): Promise<ActivityEntryPointReconciliationResult> {
  const ownedCommandId = options.ownership.getOwnedCommandId();
  if (!options.enabled) {
    if (!ownedCommandId) return { action: 'none' };
    await options.api.deleteGlobalCommand(ownedCommandId);
    options.ownership.setOwnedCommandId(undefined);
    return { action: 'deleted', commandId: ownedCommandId };
  }

  const commands = await options.api.listGlobalCommands();
  const entryPoints = commands.filter(command => command.type === PRIMARY_ENTRY_POINT);
  if (entryPoints.length > 1) {
    throw new Error('Discord returned multiple PRIMARY_ENTRY_POINT commands');
  }

  const desired = desiredFactoryFloorEntryPoint();
  const existing = entryPoints[0];
  if (!existing) {
    const created = await options.api.createGlobalCommand(desired);
    options.ownership.setOwnedCommandId(created.id);
    return { action: 'created', commandId: created.id };
  }

  if (matchesDesired(existing, desired)) {
    if (ownedCommandId !== existing.id) {
      options.ownership.setOwnedCommandId(existing.id);
    }
    return { action: 'none', commandId: existing.id };
  }

  const updated = await options.api.editGlobalCommand(existing.id, desired);
  options.ownership.setOwnedCommandId(updated.id);
  return { action: 'updated', commandId: updated.id };
}

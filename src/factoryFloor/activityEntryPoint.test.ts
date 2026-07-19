import { describe, expect, it, vi } from 'vitest';
import {
  desiredFactoryFloorEntryPoint,
  reconcileFactoryFloorEntryPoint,
  type ActivityCommandApi,
  type ActivityCommandOwnershipStore,
  type RemoteActivityCommand,
} from './activityEntryPoint.js';

function api(commands: RemoteActivityCommand[] = []): ActivityCommandApi & {
  listGlobalCommands: ReturnType<typeof vi.fn>;
  createGlobalCommand: ReturnType<typeof vi.fn>;
  editGlobalCommand: ReturnType<typeof vi.fn>;
  deleteGlobalCommand: ReturnType<typeof vi.fn>;
} {
  return {
    listGlobalCommands: vi.fn(async () => commands),
    createGlobalCommand: vi.fn(async () => ({ id: 'created-command' })),
    editGlobalCommand: vi.fn(async (id: string) => ({ id })),
    deleteGlobalCommand: vi.fn(async () => undefined),
  };
}

function store(initial?: string): ActivityCommandOwnershipStore & {
  getOwnedCommandId: ReturnType<typeof vi.fn>;
  setOwnedCommandId: ReturnType<typeof vi.fn>;
} {
  let commandId = initial;
  return {
    getOwnedCommandId: vi.fn(() => commandId),
    setOwnedCommandId: vi.fn((next?: string) => { commandId = next; }),
  };
}

const defaultEntryPoint: RemoteActivityCommand = {
  id: 'discord-default',
  name: 'Launch',
  description: 'Launch the Activity',
  type: 4,
  handler: 2,
  integration_types: [0],
  contexts: [0],
};

describe('Factory Floor Activity Entry Point reconciliation', () => {
  it('declares one guild-only PRIMARY_ENTRY_POINT using APP_HANDLER', () => {
    expect(desiredFactoryFloorEntryPoint()).toEqual({
      name: 'factory-floor',
      description: 'Open Factory Floor for the current Discord context',
      type: 4,
      handler: 1,
      integration_types: [0],
      contexts: [0],
    });
  });

  it('is a no-op when the integration is disabled and no owned command exists', async () => {
    const commandApi = api([defaultEntryPoint]);
    const ownership = store();

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: false,
      api: commandApi,
      ownership,
    })).resolves.toEqual({ action: 'none' });

    expect(commandApi.listGlobalCommands).not.toHaveBeenCalled();
    expect(commandApi.deleteGlobalCommand).not.toHaveBeenCalled();
  });

  it('removes only the command previously adopted by Discord Agent when disabled', async () => {
    const commandApi = api([defaultEntryPoint]);
    const ownership = store('owned-command');

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: false,
      api: commandApi,
      ownership,
    })).resolves.toEqual({ action: 'deleted', commandId: 'owned-command' });

    expect(commandApi.deleteGlobalCommand).toHaveBeenCalledWith('owned-command');
    expect(ownership.setOwnedCommandId).toHaveBeenCalledWith(undefined);
    expect(commandApi.listGlobalCommands).not.toHaveBeenCalled();
  });

  it('adopts and edits Discord default Entry Point instead of creating a duplicate', async () => {
    const commandApi = api([defaultEntryPoint]);
    const ownership = store();

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: true,
      api: commandApi,
      ownership,
    })).resolves.toEqual({ action: 'updated', commandId: 'discord-default' });

    expect(commandApi.editGlobalCommand).toHaveBeenCalledWith(
      'discord-default',
      desiredFactoryFloorEntryPoint(),
    );
    expect(commandApi.createGlobalCommand).not.toHaveBeenCalled();
    expect(ownership.setOwnedCommandId).toHaveBeenCalledWith('discord-default');
  });

  it('creates the Entry Point when no global PRIMARY_ENTRY_POINT exists', async () => {
    const commandApi = api([{ id: 'help', name: 'help', description: 'help', type: 1 }]);
    const ownership = store();

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: true,
      api: commandApi,
      ownership,
    })).resolves.toEqual({ action: 'created', commandId: 'created-command' });

    expect(commandApi.createGlobalCommand).toHaveBeenCalledWith(desiredFactoryFloorEntryPoint());
    expect(ownership.setOwnedCommandId).toHaveBeenCalledWith('created-command');
  });

  it('does not edit or recreate an exact current command on restart', async () => {
    const desired = desiredFactoryFloorEntryPoint();
    const commandApi = api([{ id: 'entry-1', ...desired }]);
    const ownership = store('entry-1');

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: true,
      api: commandApi,
      ownership,
    })).resolves.toEqual({ action: 'none', commandId: 'entry-1' });

    expect(commandApi.editGlobalCommand).not.toHaveBeenCalled();
    expect(commandApi.createGlobalCommand).not.toHaveBeenCalled();
    expect(ownership.setOwnedCommandId).not.toHaveBeenCalled();
  });

  it('fails closed when Discord returns multiple PRIMARY_ENTRY_POINT commands', async () => {
    const commandApi = api([
      defaultEntryPoint,
      { ...defaultEntryPoint, id: 'unexpected-second' },
    ]);

    await expect(reconcileFactoryFloorEntryPoint({
      enabled: true,
      api: commandApi,
      ownership: store(),
    })).rejects.toThrow(/multiple.*primary entry point/i);

    expect(commandApi.editGlobalCommand).not.toHaveBeenCalled();
    expect(commandApi.createGlobalCommand).not.toHaveBeenCalled();
  });
});

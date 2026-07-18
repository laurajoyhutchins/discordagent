import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import type { DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/projectRepository.js';
import { createProjectSettingsRepository, type ProjectSettingsRepository } from '../repositories/projectSettingsRepository.js';
import { createSettingsRepository, type SettingsRepository } from '../repositories/settingsRepository.js';
import type { AgentProviderId } from '../agents/contracts.js';
import { createSettingsService, type SettingsService } from './settingsService.js';

const temporaryDirectories: string[] = [];
const openDatabases: DatabaseHandle[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discord-agent-settings-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'settings.sqlite'));
  openDatabases.push(database);
  runMigrations(database);
  const projects = createProjectRepository(database);
  projects.create({
    name: 'factory-floor',
    workingDirectory: directory,
    categoryId: 'category',
    agentChannelId: 'channel',
    defaultProvider: 'codex',
    baseBranch: 'main',
    roborevChannelId: 'canonical-roborev',
  });
  const settings = createSettingsRepository(database);
  const projectSettings = createProjectSettingsRepository(database);
  const service = createSettingsService({
    settings,
    projects,
    projectSettings,
    hostDefaults: {
      defaultProvider: 'claude',
      claudeModel: 'host-claude',
      codexModel: 'host-codex',
      claudeTimeoutMs: 60_000,
      usageReserve: 10,
    },
    isProviderAvailable: () => true,
    mcpProfileCatalog: { profiles: ['default', 'browser'] },
    transaction: <T>(operation: () => T): T => database.raw.transaction(operation)(),
  });
  return { service, projects, projectSettings, settings, settingsRaw: database.raw };
}

describe('SettingsService', () => {
  it('resolves one-message model, project model, global model, then host defaults', () => {
    const { service, projects, settings } = setup();

    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'codex' }).model)
      .toBe('host-codex');
    settings.setDefaultModel('codex', 'global-codex');
    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'codex' }).model)
      .toBe('global-codex');
    projects.updateModel('factory-floor', 'codex', 'project-codex');
    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'codex' }).model)
      .toBe('project-codex');
    expect(service.resolveTaskSettings({
      projectName: 'factory-floor',
      provider: 'codex',
      modelOverride: 'message-codex',
    }).model).toBe('message-codex');
  });

  it('resolves only settings supported by each provider', () => {
    const { service, projects } = setup();
    projects.updateReasoning('factory-floor', 'codex', 'high');
    projects.updateReasoning('factory-floor', 'claude', 'high');
    service.updateProject('factory-floor', { mcpProfile: 'browser' });

    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'codex' }))
      .toEqual({ model: 'host-codex', reasoningEffort: 'high' });
    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'claude' }))
      .toEqual({ model: 'host-claude', timeoutMs: 60_000, mcpProfile: 'browser' });
  });

  it('falls back to the global model after a project model is cleared', () => {
    const { service, projects, settings } = setup();
    settings.setDefaultModel('codex', 'global-codex');
    projects.updateModel('factory-floor', 'codex', 'project-codex');
    projects.updateModel('factory-floor', 'codex');

    expect(service.resolveTaskSettings({ projectName: 'factory-floor', provider: 'codex' }).model)
      .toBe('global-codex');
  });

  it('rejects invalid timeout, usage reserve, and MCP profile before persistence', () => {
    const { service } = setup();

    expect(() => service.updateGlobal({ claudeTimeoutMs: 1 })).toThrow(/timeout/i);
    expect(() => service.updateGlobal({ usageReserve: 51 })).toThrow(/reserve/i);
    expect(() => service.updateProject('factory-floor', { mcpProfile: 'unknown' })).toThrow(/profile/i);
    expect(service.global().claudeTimeoutMs).toBeUndefined();
    expect(service.global().usageReserve).toBeUndefined();
    expect(service.project('factory-floor').mcpProfile).toBeUndefined();
  });

  it('uses null to clear MCP profile and undefined to leave it unchanged', () => {
    const { service } = setup();
    service.updateProject('factory-floor', { mcpProfile: 'browser' });
    expect(service.project('factory-floor').mcpProfile).toBe('browser');

    service.updateProject('factory-floor', {});
    expect(service.project('factory-floor').mcpProfile).toBe('browser');
    service.updateProject('factory-floor', { mcpProfile: null });
    expect(service.project('factory-floor').mcpProfile).toBeUndefined();
  });

  it('returns an immutable copy of the MCP profile catalog', () => {
    const { service } = setup();
    const catalog = service.mcpProfiles();

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.profiles)).toBe(true);
    expect(() => (catalog.profiles as string[]).push('untrusted')).toThrow();
    expect(service.mcpProfiles().profiles).toEqual(['default', 'browser']);
  });

  it('rejects unsupported Roborev setting updates at the service boundary', () => {
    const { service } = setup();
    // @ts-expect-error roborevEnabled is not a supported settings update.
    expect(() => service.updateProject('factory-floor', { roborevEnabled: false }))
      .toThrow(/roborev.*setting|unsupported/i);
  });

  it('rejects Claude reasoning project settings but preserves Codex reasoning', () => {
    const { service } = setup();
    expect(() => service.updateProject('factory-floor', { reasoningEfforts: { claude: 'high' } }))
      .toThrow(/Claude.*reasoningEffort.*support/i);
    expect(() => service.updateProject('factory-floor', { reasoningEfforts: { codex: 'high' } })).not.toThrow();
  });

  it('keeps reasoning project-scoped when the global PM model changes', () => {
    const { service, projects } = setup();
    projects.updateReasoning('factory-floor', 'codex', 'high');
    service.updateGlobal({ primaryAgentModel: 'pm-model' });

    expect(service.global()).toMatchObject({ primaryAgentModel: 'pm-model' });
    expect('reasoningEffort' in service.global()).toBe(false);
    expect(service.project('factory-floor').reasoningEfforts?.codex).toBe('high');
  });

  it('rejects missing projects and unavailable provider changes', () => {
    const { service } = setup();
    expect(() => service.project('missing')).toThrow(/Project "missing" not found/);
    expect(() => service.resolveTaskSettings({ projectName: 'missing', provider: 'codex' }))
      .toThrow(/Project "missing" not found/);

    const unavailable = createSettingsService({
      ...setupDependencies(),
      isProviderAvailable: (provider: AgentProviderId) => provider !== 'claude',
    });
    expect(() => unavailable.updateGlobal({ defaultProvider: 'claude' })).toThrow(/not available/i);
  });

  it('keeps canonical project fields authoritative over project_settings values', () => {
    const { service, projects, projectSettings } = setup();
    projects.updateModel('factory-floor', 'codex', 'canonical-codex');
    projectSettings.set('factory-floor', 'mcpProfile', 'browser');

    expect(service.project('factory-floor')).toMatchObject({
      defaultProvider: 'codex',
      codexModel: 'canonical-codex',
      baseBranch: 'main',
      roborevChannelId: 'canonical-roborev',
      mcpProfile: 'browser',
    });
  });

  it('does not persist Roborev channel updates in project_settings', () => {
    const { service, projectSettings } = setup();

    // @ts-expect-error Roborev channel identity is not a settings mutation.
    expect(() => service.updateProject('factory-floor', { roborevChannelId: 'new-roborev' }))
      .toThrow(/roborev.*lifecycle|not.*setting/i);

    expect(projectSettings.list('factory-floor')).toEqual({});
    expect(service.project('factory-floor').roborevChannelId).toBe('canonical-roborev');
  });

  it('rejects blank or whitespace base branches without clearing the canonical value', () => {
    const { service, projects } = setup();

    expect(() => service.updateProject('factory-floor', { baseBranch: '   ' }))
      .toThrow(/base branch/i);
    expect(projects.findByName('factory-floor')?.baseBranch).toBe('main');
  });

  it('rolls back all global mutations when a repository write fails', () => {
    const context = setup();
    const updateModel = vi.spyOn(context.settings, 'setDefaultModel').mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    const transactional = createSettingsService({
      ...setupDependencies(),
      settings: context.settings,
      projects: context.projects,
      projectSettings: context.projectSettings,
      transaction: operation => context.settingsRaw.transaction(operation)(),
    });

    expect(() => transactional.updateGlobal({ defaultProvider: 'claude', claudeModel: 'new-model' })).toThrow(/write failed/);
    expect(transactional.global().defaultProvider).toBeUndefined();
    expect(transactional.global().claudeModel).toBeUndefined();
    updateModel.mockRestore();
  });

  it('rolls back all project mutations when a repository write fails', () => {
    const context = setup();
    vi.spyOn(context.projects, 'updateModel').mockImplementationOnce(() => {
      throw new Error('project write failed');
    });
    const transactional = createSettingsService({
      ...setupDependencies(),
      settings: context.settings,
      projects: context.projects,
      projectSettings: context.projectSettings,
      transaction: operation => context.settingsRaw.transaction(operation)(),
    });

    expect(() => transactional.updateProject('factory-floor', {
      defaultProvider: 'claude', codexModel: 'new-model',
    })).toThrow(/project write failed/);
    expect(transactional.project('factory-floor').defaultProvider).toBe('codex');
    expect(transactional.project('factory-floor').codexModel).toBeUndefined();
  });

  it('rolls back global settings when PM activation fails', async () => {
    const { service } = setup();
    await expect(service.updateGlobalWithActivation(
      { defaultProvider: 'claude', claudeModel: 'temporary-model', claudeTimeoutMs: 30_000, usageReserve: 20 },
      async () => { throw new Error('activation failed'); },
    )).rejects.toThrow(/activation failed/);
    expect(service.global().defaultProvider).toBeUndefined();
    expect(service.global().claudeModel).toBeUndefined();
  });

  it('rejects a registered provider that is no longer live or authenticated before persistence', async () => {
    const context = setup();
    const service = createSettingsService({
      ...setupDependencies(),
      settings: context.settings,
      projects: context.projects,
      projectSettings: context.projectSettings,
      checkProviderAvailability: async () => ({ available: false, reason: 'Authentication expired' }),
    });
    await expect(service.updateGlobalWithActivation({ defaultProvider: 'claude' }, async () => undefined))
      .rejects.toThrow(/Authentication expired/);
    expect(service.global().defaultProvider).toBeUndefined();
  });
});

function setupDependencies() {
  const directory = mkdtempSync(join(tmpdir(), 'discord-agent-settings-provider-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'settings.sqlite'));
  openDatabases.push(database);
  runMigrations(database);
  const projects: ProjectRepository = createProjectRepository(database);
  projects.create({
    name: 'factory-floor', workingDirectory: directory, categoryId: 'category',
    agentChannelId: `channel-${Date.now()}`, defaultProvider: 'codex',
  });
  const settings: SettingsRepository = createSettingsRepository(database);
  const projectSettings: ProjectSettingsRepository = createProjectSettingsRepository(database);
  return {
    settings,
    projects,
    projectSettings,
    hostDefaults: { claudeTimeoutMs: 60_000, usageReserve: 10 },
    isProviderAvailable: () => true,
    mcpProfileCatalog: { profiles: ['default'] },
    transaction: <T>(operation: () => T): T => database.raw.transaction(operation)(),
  };
}

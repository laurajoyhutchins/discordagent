import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AgentProviderId } from '../agents/contracts.js';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { importLegacyProjects } from '../repositories/legacyProjectImporter.js';
import {
  createProjectRepository,
  type ProjectRepository,
} from '../repositories/projectRepository.js';
import {
  normalizeProject,
  type Project,
} from '../types.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEGACY_PATH = join(moduleDirectory, '..', 'data', 'projects.json');

export interface ProjectStorePaths {
  databasePath?: string;
  legacyPath?: string;
}

interface EphemeralProjectState {
  legacySessionId?: string;
}

let database: DatabaseHandle | null = null;
let projects: ProjectRepository | null = null;
const ephemeralState = new Map<string, EphemeralProjectState>();

function projectKey(name: string): string {
  return name.toLowerCase();
}

export function initializeProjectStore(paths: ProjectStorePaths = {}): void {
  closeProjectStore();

  database = openDatabase(paths.databasePath);
  runMigrations(database);

  const legacyPath = paths.legacyPath ?? DEFAULT_LEGACY_PATH;
  importLegacyProjects(database, legacyPath);
  projects = createProjectRepository(database);
}

export function closeProjectStore(): void {
  projects = null;
  ephemeralState.clear();
  database?.close();
  database = null;
}

function repository(): ProjectRepository {
  if (!projects) initializeProjectStore();
  return projects!;
}

export function getProjectRepository(): ProjectRepository {
  return repository();
}

export function getProjectDatabase(): DatabaseHandle {
  if (!database) initializeProjectStore();
  return database!;
}

function withEphemeral(project: Project | undefined): Project | undefined {
  if (!project) return undefined;
  const state = ephemeralState.get(projectKey(project.name));
  return state ? { ...project, ...state } : project;
}

export function getAllProjects(): Project[] {
  return repository().listActive().map(project => withEphemeral(project)!);
}

export function getProject(name: string): Project | undefined {
  return withEphemeral(repository().findByName(name));
}

export function getProjectByChannel(channelId: string): Project | undefined {
  return withEphemeral(repository().findByChannelId(channelId));
}

export function addProject(project: Project): void {
  const { legacySessionId, ...persisted } = project;
  repository().create(persisted);
  if (legacySessionId) {
    ephemeralState.set(projectKey(project.name), { legacySessionId });
  }
}

export function updateProjectSession(name: string, sessionId: string): void {
  if (!repository().findByName(name)) return;
  const key = projectKey(name);
  const current = ephemeralState.get(key) ?? {};
  if (sessionId) current.legacySessionId = sessionId;
  else delete current.legacySessionId;
  ephemeralState.set(key, current);
}

export function updateProjectModel(
  name: string,
  model: string,
  provider: AgentProviderId = 'claude',
): void {
  if (!repository().findByName(name)) return;
  repository().updateModel(name, provider, model || undefined);
}

export function updateProjectProvider(name: string, provider: AgentProviderId): void {
  if (!repository().findByName(name)) return;
  repository().updateDefaultProvider(name, provider);
}

export function removeProject(name: string): Project | undefined {
  const project = withEphemeral(repository().archive(name));
  ephemeralState.delete(projectKey(name));
  return project;
}

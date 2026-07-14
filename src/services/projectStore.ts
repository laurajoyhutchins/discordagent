import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeProject, type LegacyProjectStore, type Project, type ProjectStore } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'projects.json');

// In-memory cache to avoid repeated disk reads and race conditions
let cachedStore: ProjectStore | null = null;

function loadSync(): ProjectStore {
  if (cachedStore) return cachedStore;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LegacyProjectStore;
    cachedStore = { projects: parsed.projects.map(normalizeProject) };
    return cachedStore;
  } catch {
    cachedStore = { projects: [] };
    return cachedStore;
  }
}

// Serialize writes to prevent race conditions
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(store: ProjectStore): void {
  cachedStore = store;
  writeQueue = writeQueue
    .then(() => writeFile(DATA_PATH, JSON.stringify(store, null, 2) + '\n', 'utf-8'))
    .catch((err) => console.error('[projectStore] Failed to write:', err));
}

export function getAllProjects(): Project[] {
  return loadSync().projects;
}

export function getProject(name: string): Project | undefined {
  return loadSync().projects.find(p => p.name === name);
}

export function getProjectByChannel(channelId: string): Project | undefined {
  return loadSync().projects.find(
    p => p.agentChannelId === channelId || (p.roborevChannelId && p.roborevChannelId === channelId)
  );
}

export function addProject(project: Project): void {
  const store = loadSync();
  if (store.projects.some(p => p.name === project.name)) {
    throw new Error(`Project "${project.name}" already exists`);
  }
  store.projects.push(project);
  enqueueWrite(store);
}

export function updateProjectSession(name: string, sessionId: string): void {
  const store = loadSync();
  const project = store.projects.find(p => p.name === name);
  if (project) {
    project.legacySessionId = sessionId || undefined;
    enqueueWrite(store);
  }
}

export function updateProjectModel(name: string, model: string): void {
  const store = loadSync();
  const project = store.projects.find(p => p.name === name);
  if (project) {
    const nextModels = { ...project.models, claude: model || undefined };
    if (!nextModels.claude && !nextModels.codex) {
      project.models = undefined;
    } else {
      project.models = nextModels;
    }
    enqueueWrite(store);
  }
}

export function removeProject(name: string): Project | undefined {
  const store = loadSync();
  const idx = store.projects.findIndex(p => p.name === name);
  if (idx === -1) return undefined;
  const [removed] = store.projects.splice(idx, 1);
  enqueueWrite(store);
  return removed;
}

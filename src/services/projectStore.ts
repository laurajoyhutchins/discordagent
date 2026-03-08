import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Project, ProjectStore } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'projects.json');

function load(): ProjectStore {
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw) as ProjectStore;
  } catch {
    return { projects: [] };
  }
}

function save(store: ProjectStore): void {
  writeFileSync(DATA_PATH, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

export function getAllProjects(): Project[] {
  return load().projects;
}

export function getProject(name: string): Project | undefined {
  return load().projects.find(p => p.name === name);
}

export function getProjectByChannel(channelId: string): Project | undefined {
  return load().projects.find(
    p => p.claudeChannelId === channelId || p.roborevChannelId === channelId
  );
}

export function addProject(project: Project): void {
  const store = load();
  if (store.projects.some(p => p.name === project.name)) {
    throw new Error(`Project "${project.name}" already exists`);
  }
  store.projects.push(project);
  save(store);
}

export function removeProject(name: string): Project | undefined {
  const store = load();
  const idx = store.projects.findIndex(p => p.name === name);
  if (idx === -1) return undefined;
  const [removed] = store.projects.splice(idx, 1);
  save(store);
  return removed;
}

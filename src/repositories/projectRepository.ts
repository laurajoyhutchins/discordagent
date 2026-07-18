import { randomUUID } from 'node:crypto';
import type { AgentProviderId, ReasoningEffort } from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';
import type { Project, ProjectModels, ProjectReasoningEfforts } from '../types.js';

export type NewProject = Omit<Project, 'legacySessionId'>;

export interface ProjectRepository {
  listActive(): Project[];
  findByName(name: string): Project | undefined;
  findByChannelId(channelId: string): Project | undefined;
  create(project: NewProject, legacyMetadata?: Record<string, unknown>): Project;
  updateDefaultProvider(name: string, provider: AgentProviderId): Project;
  updateModel(name: string, provider: AgentProviderId, model?: string): Project;
  updateReasoning(name: string, provider: AgentProviderId, effort?: ReasoningEffort): Project;
  updateBaseBranch(name: string, baseBranch: string): Project;
  archive(name: string): Project | undefined;
}

interface ProjectRow {
  id: string;
  name: string;
  working_directory: string;
  category_id: string;
  agent_channel_id: string;
  default_provider: AgentProviderId;
  models_json: string;
  reasoning_efforts_json: string;
  base_branch: string | null;
  roborev_channel_id: string | null;
  legacy_metadata_json: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

function parseModels(value: string): ProjectModels | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const models: ProjectModels = {};
    if (typeof record.claude === 'string' && record.claude) models.claude = record.claude;
    if (typeof record.codex === 'string' && record.codex) models.codex = record.codex;
    return models.claude || models.codex ? models : undefined;
  } catch {
    return undefined;
  }
}

function parseReasoningEfforts(value: string): ProjectReasoningEfforts | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const efforts: ProjectReasoningEfforts = {};
    for (const provider of ['claude', 'codex'] as const) {
      if (typeof record[provider] === 'string'
        && ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(record[provider] as string)) {
        efforts[provider] = record[provider] as ReasoningEffort;
      }
    }
    return efforts.claude || efforts.codex ? efforts : undefined;
  } catch {
    return undefined;
  }
}

function toProject(row: ProjectRow): Project {
  const project: Project = {
    name: row.name,
    workingDirectory: row.working_directory,
    categoryId: row.category_id,
    agentChannelId: row.agent_channel_id,
    defaultProvider: row.default_provider,
  };

  const models = parseModels(row.models_json);
  if (models) project.models = models;
  const reasoningEfforts = parseReasoningEfforts(row.reasoning_efforts_json);
  if (reasoningEfforts) project.reasoningEfforts = reasoningEfforts;
  if (row.base_branch) project.baseBranch = row.base_branch;
  if (row.roborev_channel_id) project.roborevChannelId = row.roborev_channel_id;
  return project;
}

function serializeModels(models: ProjectModels | undefined): string {
  const compact: ProjectModels = {};
  if (models?.claude) compact.claude = models.claude;
  if (models?.codex) compact.codex = models.codex;
  return JSON.stringify(compact);
}

function serializeReasoningEfforts(efforts: ProjectReasoningEfforts | undefined): string {
  const compact: ProjectReasoningEfforts = {};
  if (efforts?.claude) compact.claude = efforts.claude;
  if (efforts?.codex) compact.codex = efforts.codex;
  return JSON.stringify(compact);
}

export function createProjectRepository(db: DatabaseHandle): ProjectRepository {
  const selectByName = db.raw.prepare(`
    SELECT * FROM projects WHERE name = ? COLLATE NOCASE
  `);
  const selectActiveByName = db.raw.prepare(`
    SELECT * FROM projects WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
  `);
  const selectActiveByChannel = db.raw.prepare(`
    SELECT * FROM projects
    WHERE archived_at IS NULL
      AND (agent_channel_id = ? OR roborev_channel_id = ?)
  `);

  function requireActive(name: string): ProjectRow {
    const row = selectActiveByName.get(name) as ProjectRow | undefined;
    if (!row) throw new Error(`Project "${name}" not found`);
    return row;
  }

  return {
    listActive(): Project[] {
      const rows = db.raw.prepare(`
        SELECT * FROM projects WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE
      `).all() as ProjectRow[];
      return rows.map(toProject);
    },

    findByName(name: string): Project | undefined {
      const row = selectActiveByName.get(name) as ProjectRow | undefined;
      return row ? toProject(row) : undefined;
    },

    findByChannelId(channelId: string): Project | undefined {
      const row = selectActiveByChannel.get(channelId, channelId) as ProjectRow | undefined;
      return row ? toProject(row) : undefined;
    },

    create(project: NewProject, legacyMetadata?: Record<string, unknown>): Project {
      const existing = selectByName.get(project.name) as ProjectRow | undefined;
      if (existing && existing.archived_at === null) {
        throw new Error(`Project "${project.name}" already exists`);
      }

      const now = Date.now();
      const modelsJson = serializeModels(project.models);
      const reasoningEffortsJson = serializeReasoningEfforts(project.reasoningEfforts);
      const metadataJson = legacyMetadata && Object.keys(legacyMetadata).length > 0
        ? JSON.stringify(legacyMetadata)
        : null;

      if (existing) {
        db.raw.prepare(`
          UPDATE projects SET
            working_directory = ?,
            category_id = ?,
            agent_channel_id = ?,
            default_provider = ?,
            models_json = ?,
            reasoning_efforts_json = ?,
            base_branch = ?,
            roborev_channel_id = ?,
            legacy_metadata_json = ?,
            archived_at = NULL,
            updated_at = ?
          WHERE id = ?
        `).run(
          project.workingDirectory,
          project.categoryId,
          project.agentChannelId,
          project.defaultProvider,
          modelsJson,
          reasoningEffortsJson,
          project.baseBranch ?? null,
          project.roborevChannelId ?? null,
          metadataJson,
          now,
          existing.id,
        );
      } else {
        db.raw.prepare(`
          INSERT INTO projects (
            id, name, working_directory, category_id, agent_channel_id,
            default_provider, models_json, reasoning_efforts_json, base_branch, roborev_channel_id,
            legacy_metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          project.name,
          project.workingDirectory,
          project.categoryId,
          project.agentChannelId,
          project.defaultProvider,
          modelsJson,
          reasoningEffortsJson,
          project.baseBranch ?? null,
          project.roborevChannelId ?? null,
          metadataJson,
          now,
          now,
        );
      }

      return this.findByName(project.name)!;
    },

    updateDefaultProvider(name: string, provider: AgentProviderId): Project {
      const row = requireActive(name);
      db.raw.prepare(`
        UPDATE projects SET default_provider = ?, updated_at = ? WHERE id = ?
      `).run(provider, Date.now(), row.id);
      return this.findByName(name)!;
    },

    updateModel(name: string, provider: AgentProviderId, model?: string): Project {
      const row = requireActive(name);
      const models = parseModels(row.models_json) ?? {};
      if (model) models[provider] = model;
      else delete models[provider];
      db.raw.prepare(`
        UPDATE projects SET models_json = ?, updated_at = ? WHERE id = ?
      `).run(serializeModels(models), Date.now(), row.id);
      return this.findByName(name)!;
    },

    updateReasoning(name: string, provider: AgentProviderId, effort?: ReasoningEffort): Project {
      const row = requireActive(name);
      const efforts = parseReasoningEfforts(row.reasoning_efforts_json) ?? {};
      if (effort) efforts[provider] = effort;
      else delete efforts[provider];
      db.raw.prepare(`
        UPDATE projects SET reasoning_efforts_json = ?, updated_at = ? WHERE id = ?
      `).run(serializeReasoningEfforts(efforts), Date.now(), row.id);
      return this.findByName(name)!;
    },

    updateBaseBranch(name: string, baseBranch: string): Project {
      const row = requireActive(name);
      db.raw.prepare(`
        UPDATE projects SET base_branch = ?, updated_at = ? WHERE id = ?
      `).run(baseBranch, Date.now(), row.id);
      return this.findByName(name)!;
    },

    archive(name: string): Project | undefined {
      const row = selectActiveByName.get(name) as ProjectRow | undefined;
      if (!row) return undefined;
      const project = toProject(row);
      const now = Date.now();
      db.raw.prepare(`
        UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, row.id);
      return project;
    },
  };
}

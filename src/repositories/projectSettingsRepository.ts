import type { DatabaseHandle } from '../db/database.js';
import type { ProjectAgentSettings } from '../settings/contracts.js';

export type ProjectSettingKey = keyof ProjectAgentSettings;
type ProjectSettingValue = ProjectAgentSettings[ProjectSettingKey];

export interface ProjectSettingsRepository {
  get<K extends ProjectSettingKey>(projectName: string, key: K): ProjectAgentSettings[K] | undefined;
  set<K extends ProjectSettingKey>(projectName: string, key: K, value: ProjectAgentSettings[K]): void;
  clear(projectName: string, key: ProjectSettingKey): void;
  list(projectName: string): ProjectAgentSettings;
}

function isKey(value: string): value is ProjectSettingKey {
  return ['defaultProvider', 'claudeModel', 'codexModel', 'baseBranch', 'mcpProfile', 'roborevEnabled', 'roborevChannelId'].includes(value);
}

function validateValue(key: ProjectSettingKey, value: ProjectSettingValue): ProjectSettingValue {
  if (key === 'roborevEnabled') {
    if (typeof value !== 'boolean') throw new Error(`Invalid project setting ${key}`);
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid project setting ${key}`);
  if (key === 'defaultProvider' && value !== 'claude' && value !== 'codex') {
    throw new Error(`Invalid project setting ${key}`);
  }
  return value.trim();
}

export function createProjectSettingsRepository(db: DatabaseHandle): ProjectSettingsRepository {
  function projectId(projectName: string): string {
    const row = db.raw.prepare(`
      SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND archived_at IS NULL
    `).get(projectName) as { id: string } | undefined;
    if (!row) throw new Error(`Project "${projectName}" not found`);
    return row.id;
  }

  function checkedKey(key: string): ProjectSettingKey {
    if (!isKey(key)) throw new Error(`Unknown project setting key: ${key}`);
    return key;
  }

  function decode(key: ProjectSettingKey, value: string): ProjectSettingValue | undefined {
    try {
      const parsed = JSON.parse(value) as unknown;
      return validateValue(key, parsed as ProjectSettingValue);
    } catch {
      return undefined;
    }
  }

  return {
    get(projectName, key) {
      const id = projectId(projectName);
      const row = db.raw.prepare('SELECT value_json FROM project_settings WHERE project_id = ? AND key = ?')
        .get(id, checkedKey(key)) as { value_json: string } | undefined;
      return row ? decode(key, row.value_json) as ProjectAgentSettings[typeof key] | undefined : undefined;
    },
    set(projectName, key, value) {
      const id = projectId(projectName);
      const checked = checkedKey(key);
      const valid = validateValue(checked, value);
      db.raw.prepare(`
        INSERT INTO project_settings (project_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(id, checked, JSON.stringify(valid), Date.now());
    },
    clear(projectName, key) {
      const id = projectId(projectName);
      db.raw.prepare('DELETE FROM project_settings WHERE project_id = ? AND key = ?').run(id, checkedKey(key));
    },
    list(projectName) {
      const id = projectId(projectName);
      const result: ProjectAgentSettings = {};
      const rows = db.raw.prepare('SELECT key, value_json FROM project_settings WHERE project_id = ?').all(id) as { key: string; value_json: string }[];
      for (const row of rows) {
        if (isKey(row.key)) {
          const value = decode(row.key, row.value_json);
          if (value !== undefined) (result as Record<string, unknown>)[row.key] = value;
        }
      }
      return result;
    },
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseHandle } from '../db/database.js';
import { normalizeProject, type LegacyProjectStore } from '../types.js';
import { createProjectRepository } from './projectRepository.js';

export type LegacyImportResult =
  | { status: 'missing'; imported: 0; skipped: 0 }
  | { status: 'already_imported'; imported: 0; skipped: 0 }
  | { status: 'imported'; imported: number; skipped: number };

function parseLegacyStore(jsonPath: string): LegacyProjectStore {
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { projects?: unknown }).projects)) {
      throw new Error('expected an object with a projects array');
    }
    return parsed as LegacyProjectStore;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse legacy projects file: ${detail}`);
  }
}

export function importLegacyProjects(db: DatabaseHandle, jsonPath: string): LegacyImportResult {
  if (!existsSync(jsonPath)) {
    return { status: 'missing', imported: 0, skipped: 0 };
  }

  const sourcePath = resolve(jsonPath);
  const importedAlready = db.raw.prepare(
    'SELECT 1 FROM legacy_imports WHERE source_path = ?',
  ).get(sourcePath);
  if (importedAlready) {
    return { status: 'already_imported', imported: 0, skipped: 0 };
  }

  const store = parseLegacyStore(jsonPath);
  const projects = createProjectRepository(db);

  return db.raw.transaction(() => {
    let imported = 0;
    let skipped = 0;

    for (const legacy of store.projects) {
      const normalized = normalizeProject(legacy);
      if (projects.findByName(normalized.name)) {
        skipped += 1;
        continue;
      }

      const {
        roborevWebhookId: _webhookId,
        roborevWebhookToken: _webhookToken,
        legacySessionId,
        ...safeProject
      } = normalized;
      const metadata = legacySessionId ? { legacySessionId } : undefined;
      projects.create(safeProject, metadata);
      imported += 1;
    }

    db.raw.prepare(`
      INSERT INTO legacy_imports (source_path, imported_at, projects_imported, projects_skipped)
      VALUES (?, ?, ?, ?)
    `).run(sourcePath, Date.now(), imported, skipped);

    return { status: 'imported' as const, imported, skipped };
  })();
}

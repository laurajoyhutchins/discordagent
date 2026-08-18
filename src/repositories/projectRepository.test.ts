import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { importLegacyProjects } from './legacyProjectImporter.js';
import { createProjectRepository } from './projectRepository.js';

const directories: string[] = [];
const handles: DatabaseHandle[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-projects-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'test.sqlite'));
  handles.push(db);
  runMigrations(db);
  return { directory, db, projects: createProjectRepository(db) };
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const sampleProject = {
  name: 'sample-project',
  workingDirectory: '/repos/sample-project',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  defaultProvider: 'claude' as const,
  models: { claude: 'sonnet' },
  baseBranch: 'main',
  roborevChannelId: 'review-1',
};

describe('ProjectRepository', () => {
  it('creates, reads, updates, archives, and deterministically reactivates projects', () => {
    const { db, projects } = setup();

    expect(projects.create(sampleProject)).toEqual(sampleProject);
    expect(projects.listActive()).toEqual([sampleProject]);
    expect(projects.findByName('SAMPLE-PROJECT')).toEqual(sampleProject);
    expect(projects.findByChannelId('agent-1')).toEqual(sampleProject);
    expect(projects.findByChannelId('review-1')).toEqual(sampleProject);

    expect(projects.updateDefaultProvider('sample-project', 'codex').defaultProvider).toBe('codex');
    expect(projects.updateModel('sample-project', 'codex', 'gpt-5.6-codex').models).toEqual({
      claude: 'sonnet',
      codex: 'gpt-5.6-codex',
    });
    expect(projects.updateModel('sample-project', 'claude', undefined).models).toEqual({
      codex: 'gpt-5.6-codex',
    });
    expect(projects.updateReasoning('sample-project', 'codex', 'xhigh').reasoningEfforts).toEqual({
      codex: 'xhigh',
    });

    const originalId = (db.raw.prepare('SELECT id FROM projects WHERE name = ?')
      .get('sample-project') as { id: string }).id;
    expect(projects.archive('sample-project')?.name).toBe('sample-project');
    expect(projects.listActive()).toEqual([]);
    expect(projects.findByName('sample-project')).toBeUndefined();

    const reactivated = projects.create({
      ...sampleProject,
      workingDirectory: '/repos/sample-project-v2',
      agentChannelId: 'agent-2',
      roborevChannelId: undefined,
    });
    const reactivatedId = (db.raw.prepare('SELECT id FROM projects WHERE name = ?')
      .get('sample-project') as { id: string }).id;

    expect(reactivated.workingDirectory).toBe('/repos/sample-project-v2');
    expect(reactivatedId).toBe(originalId);
  });

  it('rejects duplicate active projects and returns undefined for missing updates', () => {
    const { projects } = setup();
    projects.create(sampleProject);

    expect(() => projects.create(sampleProject)).toThrow(/already exists/i);
    expect(projects.archive('missing')).toBeUndefined();
    expect(() => projects.updateDefaultProvider('missing', 'codex')).toThrow(/not found/i);
    expect(() => projects.updateModel('missing', 'claude', 'opus')).toThrow(/not found/i);
    expect(() => projects.updateReasoning('missing', 'codex', 'high')).toThrow(/not found/i);
  });
});

describe('legacy project import', () => {
  it('imports once, maps Claude fields, and never persists webhook credentials', () => {
    const { directory, db, projects } = setup();
    const jsonPath = join(directory, 'projects.json');
    writeFileSync(jsonPath, JSON.stringify({
      projects: [{
        name: 'reading',
        workingDirectory: '/repos/reading',
        categoryId: 'category-reading',
        claudeChannelId: 'claude-reading',
        roborevChannelId: 'review-reading',
        roborevWebhookId: 'webhook-id-must-not-persist',
        roborevWebhookToken: 'secret-token-must-not-persist',
        sessionId: 'legacy-session-123',
        model: 'opus',
      }],
    }));

    const first = importLegacyProjects(db, jsonPath);
    const second = importLegacyProjects(db, jsonPath);

    expect(first).toEqual({ status: 'imported', imported: 1, skipped: 0 });
    expect(second).toEqual({ status: 'already_imported', imported: 0, skipped: 0 });
    expect(projects.findByName('reading')).toEqual({
      name: 'reading',
      workingDirectory: '/repos/reading',
      categoryId: 'category-reading',
      agentChannelId: 'claude-reading',
      defaultProvider: 'claude',
      models: { claude: 'opus' },
      roborevChannelId: 'review-reading',
    });

    const stored = JSON.stringify(db.raw.prepare(
      'SELECT * FROM projects WHERE name = ?'
    ).get('reading'));
    expect(stored).toContain('legacy-session-123');
    expect(stored).not.toContain('secret-token-must-not-persist');
    expect(stored).not.toContain('webhook-id-must-not-persist');
  });

  it('handles missing files, rejects malformed input, and skips active duplicates', () => {
    const { directory, db, projects } = setup();
    expect(importLegacyProjects(db, join(directory, 'missing.json'))).toEqual({
      status: 'missing', imported: 0, skipped: 0,
    });

    const malformedPath = join(directory, 'malformed.json');
    writeFileSync(malformedPath, '{not-json');
    expect(() => importLegacyProjects(db, malformedPath)).toThrow(/parse legacy projects/i);

    projects.create(sampleProject);
    const duplicatePath = join(directory, 'duplicates.json');
    writeFileSync(duplicatePath, JSON.stringify({ projects: [{
      ...sampleProject,
      claudeChannelId: sampleProject.agentChannelId,
      agentChannelId: undefined,
    }] }));

    expect(importLegacyProjects(db, duplicatePath)).toEqual({
      status: 'imported', imported: 0, skipped: 1,
    });
  });
});

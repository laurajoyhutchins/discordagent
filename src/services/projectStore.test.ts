import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addProject,
  closeProjectStore,
  getProject,
  initializeProjectStore,
  removeProject,
  updateProjectSession,
} from './projectStore.js';

const directories: string[] = [];

afterEach(() => {
  closeProjectStore();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tempPaths() {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-store-'));
  directories.push(directory);
  return {
    databasePath: join(directory, 'store.sqlite'),
    legacyPath: join(directory, 'projects.json'),
  };
}

describe('projectStore compatibility facade', () => {
  it('keeps live sessions ephemeral and discards legacy Roborev credentials', () => {
    const paths = tempPaths();
    writeFileSync(paths.legacyPath, JSON.stringify({ projects: [{
      name: 'reading',
      workingDirectory: '/repos/reading',
      categoryId: 'category-1',
      claudeChannelId: 'agent-1',
      roborevChannelId: 'review-1',
      roborevWebhookId: 'webhook-1',
      roborevWebhookToken: 'token-1',
      sessionId: 'must-not-auto-resume',
    }] }));

    initializeProjectStore(paths);
    expect(getProject('reading')).not.toHaveProperty('roborevWebhookId');
    expect(getProject('reading')).not.toHaveProperty('roborevWebhookToken');
    expect(getProject('reading')?.legacySessionId).toBeUndefined();

    updateProjectSession('reading', 'live-session');
    expect(getProject('reading')?.legacySessionId).toBe('live-session');

    closeProjectStore();
    initializeProjectStore(paths);
    expect(getProject('reading')?.legacySessionId).toBeUndefined();
  });

  it('persists project fields without accepting new webhook credentials', () => {
    const paths = tempPaths();
    initializeProjectStore(paths);

    addProject({
      name: 'factory-floor',
      workingDirectory: '/repos/factory-floor',
      categoryId: 'category-2',
      agentChannelId: 'agent-2',
      defaultProvider: 'claude',
      roborevChannelId: 'review-2',
    });

    expect(getProject('factory-floor')).toMatchObject({ roborevChannelId: 'review-2' });
    expect(getProject('factory-floor')).not.toHaveProperty('roborevWebhookId');
    expect(getProject('factory-floor')).not.toHaveProperty('roborevWebhookToken');
    expect(removeProject('factory-floor')?.name).toBe('factory-floor');
    expect(getProject('factory-floor')).toBeUndefined();
  });
});

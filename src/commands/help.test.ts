import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addProject, closeProjectStore, initializeProjectStore } from '../services/projectStore.js';
import { buildHelpEmbed, handleHelp } from './help.js';

const directories: string[] = [];

afterEach(() => {
  closeProjectStore();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function registerProject(): void {
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-help-'));
  directories.push(directory);
  initializeProjectStore({
    databasePath: join(directory, 'store.sqlite'),
    legacyPath: join(directory, 'projects.json'),
  });
  addProject({
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    roborevChannelId: 'review-1',
    defaultProvider: 'codex',
  });
}

function responseText(reply: ReturnType<typeof vi.fn>): string {
  return JSON.stringify(reply.mock.calls[0]?.[0]);
}

describe('contextual help presentation', () => {
  it('guides the primary channel toward natural PM conversation', () => {
    const embed = buildHelpEmbed({ context: 'primary' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toMatch(/primary operator channel/i);
    expect(serialized).toContain('/settings');
    expect(serialized).toMatch(/blockers|expensive/i);
  });

  it('guides a project channel toward one concrete durable task', () => {
    const embed = buildHelpEmbed({ context: 'project', projectName: 'factory-floor' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toContain('factory-floor');
    expect(serialized).toMatch(/isolated durable task/i);
    expect(serialized).toContain('/project-settings');
  });

  it('guides a task thread without implying provider-session mutation', () => {
    const embed = buildHelpEmbed({ context: 'task', projectName: 'discord-agent' }).toJSON();
    const serialized = JSON.stringify(embed);

    expect(serialized).toMatch(/reply here to continue/i);
    expect(serialized).toContain('Inspect');
    expect(serialized).toMatch(/sibling handoff/i);
  });

  it('treats a RoboRev channel as a review surface rather than a task channel', async () => {
    registerProject();
    const reply = vi.fn(async () => undefined);

    await handleHelp({
      channelId: 'review-1',
      channel: { isThread: () => false },
      reply,
    } as never);

    const response = responseText(reply);
    expect(response).toMatch(/review notifications/i);
    expect(response).toContain('<#agent-1>');
    expect(response).not.toMatch(/send a task in ordinary language/i);
  });

  it('does not mistake a thread beneath the RoboRev channel for a durable task thread', async () => {
    registerProject();
    const reply = vi.fn(async () => undefined);

    await handleHelp({
      channelId: 'review-thread-1',
      channel: { isThread: () => true, parentId: 'review-1' },
      reply,
    } as never);

    const response = responseText(reply);
    expect(response).toMatch(/review notifications/i);
    expect(response).not.toMatch(/reply here to continue the existing task/i);
  });
});

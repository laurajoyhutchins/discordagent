import { describe, expect, expectTypeOf, it } from 'vitest';
import { normalizeProject, type Project, type TaskRecord, type WorktreeRecord } from './types.js';

describe('project normalization', () => {
  it('maps legacy Claude-specific project fields to provider-neutral fields', () => {
    const project = normalizeProject({
      name: 'factory-floor',
      workingDirectory: '/repos/factory-floor',
      categoryId: 'category-1',
      claudeChannelId: 'channel-1',
      model: 'opus',
      sessionId: 'legacy-session',
    });

    expect(project.agentChannelId).toBe('channel-1');
    expect(project.defaultProvider).toBe('claude');
    expect(project.models).toEqual({ claude: 'opus' });
    expect(project.legacySessionId).toBe('legacy-session');
  });

  it('preserves provider-neutral project records', () => {
    const project = normalizeProject({
      name: 'reading',
      workingDirectory: '/repos/reading',
      categoryId: 'category-2',
      agentChannelId: 'channel-2',
      defaultProvider: 'codex',
      models: { claude: 'sonnet', codex: 'gpt-5.6-codex' },
    });

    expect(project).toMatchObject({
      agentChannelId: 'channel-2',
      defaultProvider: 'codex',
      models: { claude: 'sonnet', codex: 'gpt-5.6-codex' },
    });
  });

  it('rejects records without a usable agent channel', () => {
    expect(() => normalizeProject({
      name: 'broken',
      workingDirectory: '/repos/broken',
      categoryId: 'category-3',
    })).toThrow('Project "broken" is missing an agent channel ID');
  });
});

describe('durable task types', () => {
  it('keep provider identity and worktree identity explicit', () => {
    expectTypeOf<Project['defaultProvider']>().toEqualTypeOf<'claude' | 'codex' | 'opencode'>();
    expectTypeOf<TaskRecord['provider']>().toEqualTypeOf<'claude' | 'codex' | 'opencode'>();
    expectTypeOf<NonNullable<Project['models']>['opencode']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<WorktreeRecord['taskId']>().toEqualTypeOf<string>();
  });
});

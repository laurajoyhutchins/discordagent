import { describe, expect, it, vi } from 'vitest';
import {
  createDrivePortfolioContextAdapter,
  createGitHubPortfolioContextAdapter,
  createLinearPortfolioContextAdapter,
  createPortfolioContextHydrator,
  inferPortfolioSources,
  renderPortfolioContext,
} from './portfolioContext.js';

describe('portfolio context hydration', () => {
  it('selects only the source families required by the turn', () => {
    expect(inferPortfolioSources({ query: 'Where is the retained Fast Forward skill?' })).toEqual(['drive']);
    expect(inferPortfolioSources({ query: 'What is executable or blocked in Linear?' })).toEqual(['linear']);
    expect(inferPortfolioSources({ query: 'What changed in the discordagent repository?' })).toEqual(['github']);
    expect(inferPortfolioSources({ query: 'What is the current portfolio status?' })).toEqual([
      'github',
      'linear',
      'drive',
    ]);
    expect(inferPortfolioSources({ query: 'hello there' })).toEqual([]);
  });

  it('uses project context to bound a status request without hydrating Drive', () => {
    expect(inferPortfolioSources({ query: 'How far along are we?', currentProjectName: 'discordagent' })).toEqual([
      'github',
      'linear',
    ]);
  });

  it('records source failures instead of fabricating evidence', async () => {
    const github = createGitHubPortfolioContextAdapter({
      read: vi.fn().mockRejectedValue(new Error('github unavailable')),
    });
    const linear = createLinearPortfolioContextAdapter({
      read: vi.fn().mockResolvedValue([
        { sourceId: 'LJH-211', text: 'Hydration is In Progress', observedAt: '2026-08-12T19:50:32Z' },
      ]),
    });
    const drive = createDrivePortfolioContextAdapter({ read: vi.fn().mockResolvedValue([]) });
    const hydrator = createPortfolioContextHydrator({
      adapters: [github, linear, drive],
      now: () => '2026-08-12T20:00:00Z',
    });

    const snapshot = await hydrator.hydrate({ query: 'What is the current portfolio status?' });

    expect(snapshot?.records).toEqual([
      expect.objectContaining({
        source: 'linear',
        sourceId: 'LJH-211',
        text: 'Hydration is In Progress',
        observedAt: '2026-08-12T19:50:32Z',
      }),
    ]);
    expect(snapshot?.failures).toEqual([
      {
        source: 'github',
        observedAt: '2026-08-12T20:00:00Z',
        message: 'github unavailable',
      },
    ]);
  });

  it('does not call adapters when the turn has no portfolio intent', async () => {
    const read = vi.fn();
    const hydrator = createPortfolioContextHydrator({
      adapters: [createGitHubPortfolioContextAdapter({ read })],
    });

    const snapshot = await hydrator.hydrate({ query: 'Tell me a joke' });

    expect(snapshot).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('limits records and renders provenance plus freshness', async () => {
    const hydrator = createPortfolioContextHydrator({
      adapters: [
        createGitHubPortfolioContextAdapter({
          read: async () => [
            {
              sourceId: 'discordagent#84',
              text: 'Issue is open',
              observedAt: '2026-08-12T19:38:03Z',
              url: 'https://github.com/laurajoyhutchins/discordagent/issues/84',
            },
            {
              sourceId: 'discordagent@abc123',
              text: 'Main head',
              observedAt: '2026-08-12T19:39:00Z',
            },
          ],
        }),
      ],
      maxRecords: 1,
      now: () => '2026-08-12T20:00:00Z',
    });

    const snapshot = await hydrator.hydrate({ query: 'What changed in the repository?' });
    expect(snapshot?.records).toHaveLength(1);
    expect(renderPortfolioContext(snapshot!)).toContain(
      '[github] discordagent#84 @ 2026-08-12T19:38:03Z: Issue is open',
    );
    expect(renderPortfolioContext(snapshot!)).toContain(
      'https://github.com/laurajoyhutchins/discordagent/issues/84',
    );
  });

  it.each([
    ['github', createGitHubPortfolioContextAdapter],
    ['linear', createLinearPortfolioContextAdapter],
    ['drive', createDrivePortfolioContextAdapter],
  ] as const)('%s adapter preserves source identity and bounds its read', async (source, factory) => {
    const read = vi.fn().mockResolvedValue([
      { sourceId: 'record-1', text: 'evidence', observedAt: '2026-08-12T20:00:00Z' },
    ]);
    const adapter = factory({ read });

    const records = await adapter.read({ query: 'status', currentProjectName: 'discordagent', limit: 4 });

    expect(adapter.source).toBe(source);
    expect(read).toHaveBeenCalledWith({ query: 'status', currentProjectName: 'discordagent', limit: 4 });
    expect(records).toEqual([
      {
        source,
        sourceId: 'record-1',
        text: 'evidence',
        observedAt: '2026-08-12T20:00:00Z',
      },
    ]);
  });
});

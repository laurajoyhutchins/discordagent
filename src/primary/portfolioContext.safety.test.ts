import { describe, expect, it } from 'vitest';
import {
  createGitHubPortfolioContextAdapter,
  createPortfolioContextHydrator,
  renderPortfolioContext,
} from './portfolioContext.js';

describe('portfolio context safety', () => {
  it('redacts sensitive adapter failure details before model context rendering', async () => {
    const hydrator = createPortfolioContextHydrator({
      adapters: [
        createGitHubPortfolioContextAdapter({
          read: async () => {
            throw new Error('failed at C:\\secrets\\github.json API_KEY=sk-secret-12345');
          },
        }),
      ],
      now: () => '2026-08-12T20:00:00Z',
    });

    const snapshot = await hydrator.hydrate({ query: 'What changed in the repository?' });
    const rendered = renderPortfolioContext(snapshot!);

    expect(rendered).toContain('READ FAILURES');
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).not.toContain('sk-secret-12345');
    expect(rendered).not.toContain('C:\\secrets\\github.json');
  });
});

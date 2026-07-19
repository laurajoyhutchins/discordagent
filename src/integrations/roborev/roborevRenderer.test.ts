import { describe, expect, it } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import type { ReviewNotification } from '../reviewSource.js';
import {
  anyProjectHasRoborev,
  buildReviewEmbed,
  buildReviewText,
  hasRoborevSetup,
} from './roborevRenderer.js';

function startedNotification(overrides: Partial<ReviewNotification> = {}): ReviewNotification {
  return {
    source: 'roborev',
    projectId: 'factory-floor',
    revision: 'abcdef1234567890',
    status: 'started',
    summary: 'Reviewing abcdef12',
    details: { agent: 'reviewer', timestamp: '2026-07-18T12:00:00Z', sha: 'abcdef1234567890' },
    ...overrides,
  };
}

function completedNotification(overrides: Partial<ReviewNotification> = {}): ReviewNotification {
  return {
    source: 'roborev',
    projectId: 'factory-floor',
    revision: 'abcdef1234567890',
    status: 'passed',
    summary: 'Review abcdef12 — A',
    details: { verdict: 'A', agent: 'reviewer', jobId: 42, sha: 'abcdef1234567890', timestamp: '2026-07-18T12:00:00Z' },
    ...overrides,
  };
}

describe('buildReviewEmbed', () => {
  it('builds a started embed with grooming agent and truncated SHA', () => {
    const embed = buildReviewEmbed(startedNotification());

    expect(embed.data.title).toContain('Reviewing abcdef12');
    expect(embed.data.description).toContain('reviewer');
    expect(embed.data.color).toBe(0x95a5a6);
  });

  it('builds a completed embed with A verdict details', () => {
    const embed = buildReviewEmbed(completedNotification());

    expect(embed.data.title).toContain('Review: abcdef12');
    expect(embed.data.title).toContain('Approved');
    expect(embed.data.color).toBe(0x2ecc71);
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Commit', value: expect.stringContaining('abcdef12') }),
        expect.objectContaining({ name: 'Agent', value: 'reviewer' }),
        expect.objectContaining({ name: 'Verdict', value: expect.stringContaining('✅') }),
      ]),
    );
  });

  it('includes review body when details.body is present', () => {
    const embed = buildReviewEmbed(
      completedNotification({ details: { verdict: 'B', body: 'Minor formatting issues found.', agent: 'reviewer', jobId: 42, sha: 'abcdef1234567890', timestamp: '2026-07-18T12:00:00Z' } }),
    );

    expect(embed.data.description).toBe('Minor formatting issues found.');
  });

  it('truncates review body over 4000 characters', () => {
    const longBody = 'x'.repeat(5000);
    const embed = buildReviewEmbed(
      completedNotification({ details: { verdict: 'C', body: longBody, agent: 'reviewer', jobId: 42, sha: 'abcdef1234567890', timestamp: '2026-07-18T12:00:00Z' } }),
    );

    expect(embed.data.description).toContain('...(truncated)');
    expect(embed.data.description!.length).toBeLessThanOrEqual(4020);
  });

  it('shows roborev show command hint when no body is available', () => {
    const embed = buildReviewEmbed(completedNotification());

    expect(embed.data.description).toContain('roborev show 42');
  });

  it('uses appropriate colors per verdict', () => {
    expect(buildReviewEmbed(completedNotification({ status: 'passed', details: { verdict: 'A', agent: 'reviewer', jobId: 1, sha: 'a', timestamp: '2026-01-01T00:00:00Z' } })).data.color).toBe(0x2ecc71);
    expect(buildReviewEmbed(completedNotification({ status: 'warning', details: { verdict: 'B', agent: 'reviewer', jobId: 1, sha: 'a', timestamp: '2026-01-01T00:00:00Z' } })).data.color).toBe(0x3498db);
    expect(buildReviewEmbed(completedNotification({ status: 'failed', details: { verdict: 'F', agent: 'reviewer', jobId: 1, sha: 'a', timestamp: '2026-01-01T00:00:00Z' } })).data.color).toBe(0xe74c3c);
  });

  it('falls back to Unknown for unrecognized verdicts', () => {
    const embed = buildReviewEmbed(completedNotification({ details: { verdict: 'X', agent: 'reviewer', jobId: 1, sha: 'a', timestamp: '2026-01-01T00:00:00Z' } }));

    expect(embed.data.title).toContain('Unknown');
    expect(embed.data.color).toBe(0x95a5a6);
  });

  it('returns an EmbedBuilder instance', () => {
    expect(buildReviewEmbed(startedNotification())).toBeInstanceOf(EmbedBuilder);
  });
});

describe('buildReviewText', () => {
  it('preserves started-review meaning without an embed', () => {
    expect(buildReviewText(startedNotification())).toMatch(
      /Reviewing abcdef12.*Agent: reviewer/s,
    );
  });

  it('preserves verdict, body, attribution, and revision in bounded text', () => {
    const text = buildReviewText(completedNotification({
      status: 'warning',
      details: {
        verdict: 'B',
        body: 'Minor formatting issues found.',
        agent: 'reviewer',
        jobId: 42,
      },
    }));

    expect(text).toMatch(/Review: abcdef12.*Minor Issues/s);
    expect(text).toContain('Minor formatting issues found.');
    expect(text).toContain('Agent: reviewer');
    expect(text).toContain('Verdict: 💡 B');
    expect(text.length).toBeLessThanOrEqual(2_000);
  });

  it('truncates oversized review bodies to the Discord message limit', () => {
    const text = buildReviewText(completedNotification({
      details: {
        verdict: 'C',
        body: 'x'.repeat(5_000),
        agent: 'reviewer',
        jobId: 42,
      },
    }));

    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('anyProjectHasRoborev', () => {
  it('returns true when a project has roborevChannelId', () => {
    expect(anyProjectHasRoborev([{ roborevChannelId: 'channel-1' }])).toBe(true);
  });

  it('returns false when no project has roborevChannelId', () => {
    expect(anyProjectHasRoborev([{}, { roborevChannelId: undefined }])).toBe(false);
  });

  it('returns false for an empty list', () => {
    expect(anyProjectHasRoborev([])).toBe(false);
  });
});

describe('hasRoborevSetup', () => {
  const fakeJoin = (...parts: string[]) => parts.join('/');

  it('detects .roborev file', () => {
    expect(hasRoborevSetup('/repo', { existsSync: (p: Parameters<typeof import('node:fs').existsSync>[0]) => String(p).endsWith('.roborev'), join: fakeJoin })).toBe(true);
  });

  it('detects .roborev.json file', () => {
    expect(hasRoborevSetup('/repo', { existsSync: (p: Parameters<typeof import('node:fs').existsSync>[0]) => String(p).endsWith('.roborev.json'), join: fakeJoin })).toBe(true);
  });

  it('detects post-commit hook', () => {
    expect(hasRoborevSetup('/repo', { existsSync: (p: Parameters<typeof import('node:fs').existsSync>[0]) => String(p).includes('post-commit'), join: fakeJoin })).toBe(true);
  });

  it('returns false when none of the marker files exist', () => {
    expect(hasRoborevSetup('/repo', { existsSync: () => false, join: fakeJoin })).toBe(false);
  });
});

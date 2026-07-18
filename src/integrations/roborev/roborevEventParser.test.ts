import { describe, expect, it } from 'vitest';
import type { Project } from '../../types.js';
import { matchProject, normalizeToNotification, mapVerdictToStatus } from './roborevEventParser.js';
import type { RoborevStreamEvent } from './types.js';

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'cat-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
    roborevChannelId: 'review-1',
    ...overrides,
  };
}

describe('matchProject', () => {
  it('matches an exact working-directory path', () => {
    const result = matchProject('/repos/factory-floor', [project()]);
    expect(result?.name).toBe('factory-floor');
  });

  it('matches a repository nested under the project directory', () => {
    const result = matchProject('/repos/factory-floor/src/lib', [project()]);
    expect(result?.name).toBe('factory-floor');
  });

  it('does not match a similarly prefixed path', () => {
    const result = matchProject('/repos/factory-floor-copy', [project()]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when the project has no roborev channel', () => {
    const result = matchProject('/repos/factory-floor', [
      project({ roborevChannelId: undefined }),
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no project matches', () => {
    const result = matchProject('/repos/other-project', [project()]);
    expect(result).toBeUndefined();
  });

  it('handles trailing slashes on both sides', () => {
    const result = matchProject('/repos/factory-floor/', [project()]);
    expect(result?.name).toBe('factory-floor');
  });

  it('matches case-insensitively', () => {
    const result = matchProject('/REPOS/FACTORY-FLOOR', [project()]);
    expect(result?.name).toBe('factory-floor');
  });
});

describe('normalizeToNotification', () => {
  const baseEvent: RoborevStreamEvent = {
    type: 'review.started',
    ts: '2026-07-18T12:00:00Z',
    job_id: 42,
    repo: '/repos/factory-floor',
    repo_name: 'factory-floor',
    sha: 'abcdef1234567890',
    agent: 'reviewer',
  };

  it('normalizes a review.started event', () => {
    const notification = normalizeToNotification(baseEvent, 'factory-floor');

    expect(notification.source).toBe('roborev');
    expect(notification.projectId).toBe('factory-floor');
    expect(notification.revision).toBe('abcdef1234567890');
    expect(notification.status).toBe('started');
    expect(notification.summary).toBe('Reviewing abcdef12');
    expect(notification.details?.agent).toBe('reviewer');
    expect(notification.details?.timestamp).toBe('2026-07-18T12:00:00Z');
    expect(notification.details?.sha).toBe('abcdef1234567890');
  });

  it('normalizes a review.completed event with verdict A', () => {
    const notification = normalizeToNotification(
      { ...baseEvent, type: 'review.completed', verdict: 'A' },
      'factory-floor',
    );

    expect(notification.status).toBe('passed');
    expect(notification.summary).toBe('Review abcdef12 — A');
    expect(notification.details?.verdict).toBe('A');
    expect(notification.details?.jobId).toBe(42);
  });

  it('normalizes a review.completed event with verdict F', () => {
    const notification = normalizeToNotification(
      { ...baseEvent, type: 'review.completed', verdict: 'F' },
      'factory-floor',
    );

    expect(notification.status).toBe('failed');
    expect(notification.details?.verdict).toBe('F');
  });

  it('normalizes a review.completed event without a verdict', () => {
    const notification = normalizeToNotification(
      { ...baseEvent, type: 'review.completed' },
      'factory-floor',
    );

    expect(notification.status).toBe('warning');
    expect(notification.details?.verdict).toBeUndefined();
  });

  it('handles unknown event types gracefully', () => {
    const notification = normalizeToNotification(
      { ...baseEvent, type: 'review.pending' },
      'factory-floor',
    );

    expect(notification.source).toBe('roborev');
    expect(notification.status).toBe('started');
    expect(notification.summary).toBe('Event: review.pending');
    expect(notification.details?.type).toBe('review.pending');
  });
});

describe('mapVerdictToStatus', () => {
  it('maps A to passed', () => expect(mapVerdictToStatus('A')).toBe('passed'));
  it('maps B to warning', () => expect(mapVerdictToStatus('B')).toBe('warning'));
  it('maps C to failed', () => expect(mapVerdictToStatus('C')).toBe('failed'));
  it('maps D to failed', () => expect(mapVerdictToStatus('D')).toBe('failed'));
  it('maps F to failed', () => expect(mapVerdictToStatus('F')).toBe('failed'));
  it('maps undefined to warning', () => expect(mapVerdictToStatus(undefined)).toBe('warning'));
  it('maps unknown grade to warning', () => expect(mapVerdictToStatus('X')).toBe('warning'));
});

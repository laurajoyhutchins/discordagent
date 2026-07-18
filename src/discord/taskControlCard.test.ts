import { describe, expect, it } from 'vitest';
import {
  parseTaskControlCustomId,
  renderTaskControlCard,
  taskControlCustomId,
  type TaskControlCardView,
} from './taskControlCard.js';

const view: TaskControlCardView = {
  taskId: 'task-1',
  objective: 'Implement api_key=sk-proj-1234567890 safely',
  projectName: 'factory-floor',
  provider: 'claude',
  model: 'claude-sonnet',
  status: 'running',
  branchName: 'agent/claude/factory-floor-123',
  sessionState: 'active',
  phase: 'Inspecting files',
  usagePosture: 'healthy',
};

function componentIds(payload: ReturnType<typeof renderTaskControlCard>): string[] {
  return payload.components?.flatMap(row => row.toJSON().components.map(component => component.custom_id ?? '')) ?? [];
}

describe('task control card rendering', () => {
  it('renders a valid embed with authoritative task state without sensitive identifiers', () => {
    const payload = renderTaskControlCard(view, { embeds: true });
    const embed = payload.embeds?.[0].toJSON();
    const serialized = JSON.stringify(payload);

    expect(embed).toMatchObject({ title: expect.stringMatching(/task/i) });
    expect(serialized).toContain('factory-floor');
    expect(serialized).toContain('claude-sonnet');
    expect(serialized).toContain('agent/claude/factory-floor-123');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('sk-proj-1234567890');
    expect(serialized).not.toContain('task-1');
    expect(serialized).not.toContain('sessionId');
  });

  it('renders a readable plain-text fallback when embeds are unavailable', () => {
    const payload = renderTaskControlCard({ ...view, phase: undefined }, { embeds: false });
    const text = payload.content;

    expect(text).toContain('Objective:');
    expect(text).toContain('State: running');
    expect(text).toContain('Provider: claude');
    expect(text).toContain('Session: active');
    expect(text).not.toContain('task-1');
    expect(text).not.toContain('sk-proj-1234567890');
  });

  it('falls back to bounded plain text when aggregate embed output is too large', () => {
    const payload = renderTaskControlCard({ ...view, objective: 'x'.repeat(3_900), phase: 'y'.repeat(1_000) }, { embeds: true });

    expect(payload.embeds).toBeUndefined();
    expect(payload.content.length).toBeLessThanOrEqual(1_900);
    expect(payload.content).toContain('Objective:');
  });

  it('adds inspect and cancel controls to active cards in embed and plain-text modes', () => {
    const embedPayload = renderTaskControlCard(view, { embeds: true });
    const textPayload = renderTaskControlCard(view, { embeds: false });

    expect(componentIds(embedPayload)).toEqual([
      taskControlCustomId('inspect'),
      taskControlCustomId('cancel'),
    ]);
    expect(componentIds(textPayload)).toEqual(componentIds(embedPayload));
  });

  it('removes cancel from terminal cards while retaining inspect', () => {
    const payload = renderTaskControlCard({ ...view, status: 'completed', sessionState: 'preserved' }, { embeds: true });

    expect(componentIds(payload)).toEqual([taskControlCustomId('inspect')]);
  });

  it('parses only supported stable task-control IDs', () => {
    expect(parseTaskControlCustomId(taskControlCustomId('inspect'))).toBe('inspect');
    expect(parseTaskControlCustomId(taskControlCustomId('cancel'))).toBe('cancel');
    expect(parseTaskControlCustomId('task-control:delete')).toBeUndefined();
    expect(taskControlCustomId('inspect')).not.toContain('task-1');
  });
});
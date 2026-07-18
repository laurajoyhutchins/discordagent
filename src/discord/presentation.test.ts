import { describe, expect, it } from 'vitest';
import {
  formatEmptyState,
  sessionStateLabel,
  taskStatusLabel,
  taskStatusTone,
} from './presentation.js';

describe('operator presentation helpers', () => {
  it('maps durable task states to concise operator language', () => {
    expect(taskStatusLabel('created')).toBe('Queued');
    expect(taskStatusLabel('waiting_for_user')).toBe('Needs your input');
    expect(taskStatusLabel('completed')).toBe('Completed');
    expect(sessionStateLabel('not_started')).toBe('Not started');
  });

  it('uses attention and terminal tones consistently', () => {
    expect(taskStatusTone('waiting_for_user')).toBe('attention');
    expect(taskStatusTone('completed')).toBe('success');
    expect(taskStatusTone('failed')).toBe('danger');
  });

  it('formats empty states with one explicit next action', () => {
    expect(formatEmptyState({
      title: 'No projects yet',
      description: 'Nothing is registered.',
      action: 'Run `/add-project`.',
    })).toBe('**No projects yet**\nNothing is registered.\nNext: Run `/add-project`.');
  });
});

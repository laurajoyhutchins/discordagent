import { describe, expect, it } from 'vitest';
import { buildErrorEmbed, isStructuredErrorMessage } from './errorCard.js';

describe('Discord error cards', () => {
  it('turns a structured provider error into a native Discord embed', () => {
    const error = new Error(JSON.stringify({
      type: 'error',
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: "The 'gpt-5.6-luna' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      },
    }));

    const rendered = buildErrorEmbed(error, 'Request failed').toJSON();
    const serialized = JSON.stringify(rendered);

    expect(rendered.title).toBe('❌ Request failed');
    expect(rendered.description).toContain('requires a newer version of Codex');
    expect(rendered.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Status', value: '400' }),
      expect.objectContaining({ name: 'Type', value: 'invalid_request_error' }),
    ]));
    expect(serialized).not.toContain('{"type":"error"');
  });

  it('detects structured errors embedded in provider text without treating normal prose as an error', () => {
    expect(isStructuredErrorMessage(`I could not complete the turn: ${JSON.stringify({
      type: 'error', status: 400, error: { message: 'Bad request' },
    })}`)).toBe(true);
    expect(isStructuredErrorMessage('The task completed successfully.')).toBe(false);
  });

  it('redacts secret-bearing structured status, type, and code fields', () => {
    const rendered = buildErrorEmbed(new Error(JSON.stringify({
      type: 'error', status: 'apiKey=json-status-secret',
      error: { type: 'Bearer json-type-secret', code: 'deviceCode=json-code-secret', message: 'Request failed' },
    }))).toJSON();
    const serialized = JSON.stringify(rendered);
    expect(serialized).not.toContain('json-status-secret');
    expect(serialized).not.toContain('json-type-secret');
    expect(serialized).not.toContain('json-code-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});

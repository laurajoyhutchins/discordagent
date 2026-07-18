import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../agents/contracts.js';
import { redactAgentEvent, redactErrorMessage, redactSensitiveText, safeStringify } from './redaction.js';

describe('secret redaction', () => {
  it('redacts common assignment, bearer, OpenAI, and GitHub token forms', () => {
    const input = [
      'DISCORD_TOKEN=discord-secret',
      'api-key: "api-secret"',
      'Authorization: Bearer bearer-secret',
      'sk-proj-openai-secret',
      'github_pat_github-secret',
    ].join(' ');

    const redacted = redactSensitiveText(input);

    expect(redacted).not.toContain('discord-secret');
    expect(redacted).not.toContain('api-secret');
    expect(redacted).not.toContain('bearer-secret');
    expect(redacted).not.toContain('openai-secret');
    expect(redacted).not.toContain('github-secret');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts nested sensitive object keys before serialization', () => {
    const serialized = safeStringify({
      command: 'npm test',
      auth: { accessToken: 'nested-secret' },
      headers: { authorization: 'Bearer header-secret' },
    });

    expect(serialized).toContain('npm test');
    expect(serialized).not.toContain('nested-secret');
    expect(serialized).not.toContain('header-secret');
  });

  it('redacts quoted JSON secret keys in text payloads', () => {
    const redacted = redactSensitiveText('{"apiKey":"json-secret","nested":{"password":"json-password"}}');

    expect(redacted).not.toContain('json-secret');
    expect(redacted).not.toContain('json-password');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts device and verification fields embedded in URLs and errors', () => {
    const redacted = redactSensitiveText('verificationUrl=https://example.test/device?user_code=URL-CODE verificationCode=ERROR-CODE');

    expect(redacted).not.toContain('URL-CODE');
    expect(redacted).not.toContain('ERROR-CODE');
  });


  it('redacts secrets from unknown errors before logging', () => {
    const error = new Error('provider failed with API_KEY=log-secret and Bearer bearer-log-secret');

    const message = redactErrorMessage(error);

    expect(message).not.toContain('log-secret');
    expect(message).not.toContain('bearer-log-secret');
    expect(message).toContain('[REDACTED]');
  });

  it('redacts normalized events before they cross persistence and Discord boundaries', () => {
    const event: AgentEvent = {
      type: 'completed',
      result: {
        provider: 'claude',
        outcome: 'failed',
        exitType: 'error',
        startedAt: 1,
        completedAt: 2,
        summary: 'Request failed with API_KEY=summary-secret',
        error: {
          code: 'provider_error',
          message: 'Authorization: Bearer message-secret',
          details: 'github_pat_details-secret',
          retryable: false,
        },
      },
    };

    const redacted = redactAgentEvent(event);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('summary-secret');
    expect(serialized).not.toContain('message-secret');
    expect(serialized).not.toContain('details-secret');
  });
});

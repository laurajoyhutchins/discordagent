import { describe, expect, it } from 'vitest';
import { createSettingsService } from './settingsService.js';

function setup() {
  const project = {
    name: 'discordagent',
    workingDirectory: '/repo',
    categoryId: 'category',
    agentChannelId: 'agent-channel',
    defaultProvider: 'claude' as const,
  };
  const service = createSettingsService({
    settings: {
      getDefaultProvider: () => undefined,
      getDefaultModel: () => undefined,
      getPrimaryAgentModel: () => undefined,
      getClaudeTimeoutMs: () => 30_000,
      getUsageReserve: () => 10,
      getReasoningEffort: () => undefined,
    } as never,
    projects: { findByName: () => project } as never,
    projectSettings: { list: () => ({}) } as never,
    hostDefaults: { claudeTimeoutMs: 30_000, usageReserve: 10 },
    isProviderAvailable: () => true,
    mcpProfileCatalog: { profiles: ['default', 'disabled', 'github', 'linear', 'drive'] },
    transaction: operation => operation(),
  });
  return service;
}

describe('bounded task settings override', () => {
  it('applies one capability only inside the authorized launch scope', async () => {
    const service = setup();

    const authorized = await service.runWithTaskSettingsOverride(
      { mcpProfile: 'linear' },
      async () => service.resolveTaskSettings({ projectName: 'discordagent', provider: 'claude' }),
    );

    expect(authorized).toEqual({ timeoutMs: 30_000, mcpProfile: 'linear' });
    expect(service.resolveTaskSettings({ projectName: 'discordagent', provider: 'claude' }))
      .toEqual({ timeoutMs: 30_000 });
  });

  it('fails closed when a scoped capability reaches a provider without MCP profile support', async () => {
    const service = setup();

    await expect(service.runWithTaskSettingsOverride(
      { mcpProfile: 'linear' },
      async () => service.resolveTaskSettings({ projectName: 'discordagent', provider: 'codex' }),
    )).rejects.toThrow(/does not support/i);
  });
});

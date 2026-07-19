import type { AgentProviderId } from './contracts.js';

export interface ProviderHostConfiguration {
  readonly id: AgentProviderId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly enabledEnv: 'CLAUDE_ENABLED' | 'CODEX_ENABLED' | 'OPENCODE_ENABLED';
  readonly command: string;
  readonly versionArgs: readonly string[];
}

interface ProviderDefinition {
  readonly id: AgentProviderId;
  readonly displayName: string;
  readonly enabledEnv: ProviderHostConfiguration['enabledEnv'];
  readonly commandEnv?: 'CODEX_CLI_PATH' | 'OPENCODE_CLI_PATH';
  readonly defaultCommand: string;
  readonly versionArgs: readonly string[];
}

const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: 'claude',
    displayName: 'Claude',
    enabledEnv: 'CLAUDE_ENABLED',
    defaultCommand: 'claude',
    versionArgs: ['--version'],
  },
  {
    id: 'codex',
    displayName: 'Codex',
    enabledEnv: 'CODEX_ENABLED',
    commandEnv: 'CODEX_CLI_PATH',
    defaultCommand: 'codex',
    versionArgs: ['--version'],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    enabledEnv: 'OPENCODE_ENABLED',
    commandEnv: 'OPENCODE_CLI_PATH',
    defaultCommand: 'opencode',
    versionArgs: ['--version'],
  },
];

const PROVIDER_IDS = new Set<AgentProviderId>(
  PROVIDER_DEFINITIONS.map(provider => provider.id),
);

export function resolveProviderHostConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): readonly ProviderHostConfiguration[] {
  return PROVIDER_DEFINITIONS.map(definition => ({
    id: definition.id,
    displayName: definition.displayName,
    enabled: env[definition.enabledEnv] !== 'false',
    enabledEnv: definition.enabledEnv,
    command: definition.commandEnv
      ? env[definition.commandEnv]?.trim() || definition.defaultCommand
      : definition.defaultCommand,
    versionArgs: definition.versionArgs,
  }));
}

export function resolveRequiredProviderIds(
  env: NodeJS.ProcessEnv = process.env,
): readonly AgentProviderId[] {
  const required: AgentProviderId[] = [];
  const seen = new Set<AgentProviderId>();

  for (const candidate of (env.REQUIRED_PROVIDERS ?? '').split(',')) {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) continue;
    if (!PROVIDER_IDS.has(normalized as AgentProviderId)) {
      throw new Error(
        `Unknown provider "${normalized}" in REQUIRED_PROVIDERS. `
        + 'Expected a comma-separated subset of: claude, codex, opencode.',
      );
    }
    const provider = normalized as AgentProviderId;
    if (seen.has(provider)) continue;
    seen.add(provider);
    required.push(provider);
  }

  return required;
}

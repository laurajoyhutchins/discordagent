import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content);
  console.log(`[reconcile] updated ${path}`);
}

function replace(path, before, after) {
  const content = read(path);
  if (!content.includes(before)) {
    throw new Error(`Expected text not found in ${path}: ${before.slice(0, 120)}`);
  }
  write(path, content.replace(before, after));
}

function replaceAll(path, before, after) {
  const content = read(path);
  if (!content.includes(before)) {
    throw new Error(`Expected text not found in ${path}: ${before.slice(0, 120)}`);
  }
  write(path, content.split(before).join(after));
}

// Keep the Discord permission registry aligned with the current API surface.
replace('package.json', '"discord.js": "^14.16.0"', '"discord.js": "^14.24.0"');

// Provider-neutral contracts and persistent provider identity.
replace(
  'src/agents/contracts.ts',
  "export const AGENT_PROVIDER_IDS = ['claude', 'codex'] as const;",
  "export const AGENT_PROVIDER_IDS = ['claude', 'codex', 'opencode'] as const;",
);
replace(
  'src/agents/contracts.ts',
  "  codex: {\n    task: ['model', 'reasoningEffort'],\n    turn: ['model', 'reasoningEffort'],\n  },\n} as const satisfies Record<AgentProviderId, Record<AgentSettingsScope, readonly string[]>>;",
  "  codex: {\n    task: ['model', 'reasoningEffort'],\n    turn: ['model', 'reasoningEffort'],\n  },\n  opencode: {\n    task: ['model'],\n    turn: ['model'],\n  },\n} as const satisfies Record<AgentProviderId, Record<AgentSettingsScope, readonly string[]>>;",
);
replace(
  'src/repositories/settingsRepository.ts',
  "import { REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';",
  "import { isAgentProviderId, REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';",
);
replace(
  'src/repositories/settingsRepository.ts',
  "      return value === 'claude' || value === 'codex' ? value : undefined;",
  "      return isAgentProviderId(value) ? value : undefined;",
);

// Provider-indexed project storage.
replace(
  'src/types.ts',
  "export interface ProjectModels {\n  claude?: string;\n  codex?: string;\n}\n\nexport interface ProjectReasoningEfforts {\n  claude?: ReasoningEffort;\n  codex?: ReasoningEffort;\n}",
  "export type ProjectModels = Partial<Record<AgentProviderId, string>>;\n\nexport type ProjectReasoningEfforts = Partial<Record<AgentProviderId, ReasoningEffort>>;",
);
replace(
  'src/repositories/projectRepository.ts',
  "import type { AgentProviderId, ReasoningEffort } from '../agents/contracts.js';",
  "import { AGENT_PROVIDER_IDS, REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';",
);
replace(
  'src/repositories/projectRepository.ts',
  "    const models: ProjectModels = {};\n    if (typeof record.claude === 'string' && record.claude) models.claude = record.claude;\n    if (typeof record.codex === 'string' && record.codex) models.codex = record.codex;\n    return models.claude || models.codex ? models : undefined;",
  "    const models: ProjectModels = {};\n    for (const provider of AGENT_PROVIDER_IDS) {\n      if (typeof record[provider] === 'string' && record[provider]) models[provider] = record[provider] as string;\n    }\n    return Object.keys(models).length > 0 ? models : undefined;",
);
replace(
  'src/repositories/projectRepository.ts',
  "    for (const provider of ['claude', 'codex'] as const) {\n      if (typeof record[provider] === 'string'\n        && ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(record[provider] as string)) {\n        efforts[provider] = record[provider] as ReasoningEffort;\n      }\n    }\n    return efforts.claude || efforts.codex ? efforts : undefined;",
  "    for (const provider of AGENT_PROVIDER_IDS) {\n      if (typeof record[provider] === 'string'\n        && REASONING_EFFORTS.includes(record[provider] as ReasoningEffort)) {\n        efforts[provider] = record[provider] as ReasoningEffort;\n      }\n    }\n    return Object.keys(efforts).length > 0 ? efforts : undefined;",
);
replace(
  'src/repositories/projectRepository.ts',
  "function serializeModels(models: ProjectModels | undefined): string {\n  const compact: ProjectModels = {};\n  if (models?.claude) compact.claude = models.claude;\n  if (models?.codex) compact.codex = models.codex;\n  return JSON.stringify(compact);\n}\n\nfunction serializeReasoningEfforts(efforts: ProjectReasoningEfforts | undefined): string {\n  const compact: ProjectReasoningEfforts = {};\n  if (efforts?.claude) compact.claude = efforts.claude;\n  if (efforts?.codex) compact.codex = efforts.codex;\n  return JSON.stringify(compact);\n}",
  "function serializeModels(models: ProjectModels | undefined): string {\n  const compact: ProjectModels = {};\n  for (const provider of AGENT_PROVIDER_IDS) {\n    if (models?.[provider]) compact[provider] = models[provider];\n  }\n  return JSON.stringify(compact);\n}\n\nfunction serializeReasoningEfforts(efforts: ProjectReasoningEfforts | undefined): string {\n  const compact: ProjectReasoningEfforts = {};\n  for (const provider of AGENT_PROVIDER_IDS) {\n    if (efforts?.[provider]) compact[provider] = efforts[provider];\n  }\n  return JSON.stringify(compact);\n}",
);

// OpenCode host configuration.
replace(
  'src/config.ts',
  "  codexEnabled: process.env.CODEX_ENABLED !== 'false',\n  authorizedUserId:",
  "  codexEnabled: process.env.CODEX_ENABLED !== 'false',\n  openCodeCliPath: process.env.OPENCODE_CLI_PATH ?? 'opencode',\n  openCodeEnabled: process.env.OPENCODE_ENABLED !== 'false',\n  openCodeTimeoutMs: parseInt(process.env.OPENCODE_TIMEOUT_MS ?? '900000', 10),\n  defaultOpenCodeModel: process.env.OPENCODE_MODEL ?? '',\n  openCodePrimaryModel: process.env.OPENCODE_PRIMARY_MODEL ?? '',\n  authorizedUserId:",
);

// Settings contracts and provider/model key helpers.
replaceAll(
  'src/settings/contracts.ts',
  '  codexModel?: string;\n',
  '  codexModel?: string;\n  openCodeModel?: string;\n',
);
replace(
  'src/services/settingsService.ts',
  "import { validateSupportedAgentSettings, type AgentProviderId, type AgentTaskSettings, type ReasoningEffort } from '../agents/contracts.js';",
  "import { AGENT_PROVIDER_IDS, validateSupportedAgentSettings, type AgentProviderId, type AgentTaskSettings, type ReasoningEffort } from '../agents/contracts.js';",
);
replace(
  'src/services/settingsService.ts',
  "  codexModel?: string;\n  primaryAgentModel?: string;",
  "  codexModel?: string;\n  openCodeModel?: string;\n  primaryAgentModel?: string;",
);
replace(
  'src/services/settingsService.ts',
  "export function createSettingsService(dependencies: SettingsServiceDependencies): SettingsService {",
  "function modelSettingKey(provider: AgentProviderId): 'claudeModel' | 'codexModel' | 'openCodeModel' {\n  return provider === 'claude' ? 'claudeModel' : provider === 'codex' ? 'codexModel' : 'openCodeModel';\n}\n\nexport function createSettingsService(dependencies: SettingsServiceDependencies): SettingsService {",
);
replace(
  'src/services/settingsService.ts',
  "    const codexModel = settings.getDefaultModel('codex');\n    const primaryAgentModel",
  "    const codexModel = settings.getDefaultModel('codex');\n    const openCodeModel = settings.getDefaultModel('opencode');\n    const primaryAgentModel",
);
replace(
  'src/services/settingsService.ts',
  "    for (const provider of ['claude', 'codex'] as const) {",
  "    for (const provider of AGENT_PROVIDER_IDS) {",
);
replace(
  'src/services/settingsService.ts',
  "    if (codexModel) result.codexModel = codexModel;\n    if (primaryAgentModel)",
  "    if (codexModel) result.codexModel = codexModel;\n    if (openCodeModel) result.openCodeModel = openCodeModel;\n    if (primaryAgentModel)",
);
replace(
  'src/services/settingsService.ts',
  "      ...(current.models?.codex ? { codexModel: current.models.codex } : {}),",
  "      ...(current.models?.codex ? { codexModel: current.models.codex } : {}),\n      ...(current.models?.opencode ? { openCodeModel: current.models.opencode } : {}),",
);
replace(
  'src/services/settingsService.ts',
  "    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);\n    const primaryAgentModel",
  "    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);\n    const openCodeModel = input.openCodeModel === undefined ? undefined : validateModelOverride(input.openCodeModel);\n    const primaryAgentModel",
);
replaceAll(
  'src/services/settingsService.ts',
  "for (const provider of ['claude', 'codex'] as const)",
  'for (const provider of AGENT_PROVIDER_IDS)',
);
replace(
  'src/services/settingsService.ts',
  "      if (input.codexModel !== undefined) settings.setDefaultModel('codex', codexModel);\n      if (input.primaryAgentModel",
  "      if (input.codexModel !== undefined) settings.setDefaultModel('codex', codexModel);\n      if (input.openCodeModel !== undefined) settings.setDefaultModel('opencode', openCodeModel);\n      if (input.primaryAgentModel",
);
replace(
  'src/services/settingsService.ts',
  "        settings.setDefaultModel('codex', before.codexModel);\n        settings.setPrimaryAgentModel",
  "        settings.setDefaultModel('codex', before.codexModel);\n        settings.setDefaultModel('opencode', before.openCodeModel);\n        settings.setPrimaryAgentModel",
);
replace(
  'src/services/settingsService.ts',
  "        settings.setReasoningEffort('codex', before.reasoningEfforts?.codex);",
  "        settings.setReasoningEffort('codex', before.reasoningEfforts?.codex);\n        settings.setReasoningEffort('opencode', before.reasoningEfforts?.opencode);",
);
replace(
  'src/services/settingsService.ts',
  "    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);\n    const mcpProfile",
  "    const codexModel = input.codexModel === undefined ? undefined : validateModelOverride(input.codexModel);\n    const openCodeModel = input.openCodeModel === undefined ? undefined : validateModelOverride(input.openCodeModel);\n    const mcpProfile",
);
replace(
  'src/services/settingsService.ts',
  "      if (input.codexModel !== undefined) projects.updateModel(projectName, 'codex', codexModel);\n      if (input.reasoningEfforts",
  "      if (input.codexModel !== undefined) projects.updateModel(projectName, 'codex', codexModel);\n      if (input.openCodeModel !== undefined) projects.updateModel(projectName, 'opencode', openCodeModel);\n      if (input.reasoningEfforts",
);
replace(
  'src/services/settingsService.ts',
  "    const providerModel = input.provider === 'claude' ? 'claudeModel' : 'codexModel';\n    const hostModel = input.provider === 'claude' ? hostDefaults.claudeModel : hostDefaults.codexModel;",
  "    const providerModel = modelSettingKey(input.provider);\n    const hostModel = input.provider === 'claude'\n      ? hostDefaults.claudeModel\n      : input.provider === 'codex'\n        ? hostDefaults.codexModel\n        : hostDefaults.openCodeModel;",
);

// Primary-agent proposal schema.
write('src/primary/primaryModel.ts', `import type { AgentProviderId } from '../agents/contracts.js';

export interface PrimaryTaskProposal { projectName: string; objective: string; provider?: AgentProviderId; rationale?: string; }
export interface PrimaryMemoryWrite { namespace: string; key: string; value: unknown; sourceQuote: string; confidence?: number; }
export interface PrimaryDecision { kind: 'confirm' | 'select' | 'poll'; prompt: string; options: string[]; }
export interface PrimaryResponse { reply: string; taskProposal?: PrimaryTaskProposal; memoryWrites?: PrimaryMemoryWrite[]; decision?: PrimaryDecision; }
export interface PrimaryModel { respond(input: { context: string; message: string }): Promise<PrimaryResponse>; }

export function buildPrimaryPrompt(input: { context: string; message: string }): string {
  return \`You are the primary project-owner agent in a private Discord workspace. Be concise and outcome-focused. You may discuss, remember direct user preferences only when you include an exact sourceQuote copied from the current user message, propose one bounded coding task, or request a decision. You have no coding tools and must not pretend to execute work. Return only JSON matching: {"reply":string,"taskProposal"?:{"projectName":string,"objective":string,"provider"?:"claude"|"codex"|"opencode","rationale"?:string},"memoryWrites"?:[{"namespace":string,"key":string,"value":unknown,"sourceQuote":string,"confidence"?:number}],"decision"?:{"kind":"confirm"|"select"|"poll","prompt":string,"options":string[]}}.\\n\\nWORKSPACE CONTEXT\\n\${input.context}\\n\\nUSER\\n\${input.message}\`;
}

export function parsePrimaryResponse(text: string): PrimaryResponse {
  const match = text.match(/\\{[\\s\\S]*\\}/);
  if (!match) return { reply: text.trim() || 'I could not form a response.' };
  const parsed = JSON.parse(match[0]) as PrimaryResponse;
  if (!parsed.reply || typeof parsed.reply !== 'string') throw new Error('Primary model response omitted reply');
  return parsed;
}
`);

// Slash commands and labels.
replace(
  'src/commands/definitions.ts',
  "          { name: 'Codex', value: 'codex' },",
  "          { name: 'Codex', value: 'codex' },\n          { name: 'OpenCode', value: 'opencode' },",
);
replace(
  'src/utils/providerUtils.ts',
  "import type { AgentProviderId } from '../agents/contracts.js';",
  "import type { AgentProviderId } from '../agents/contracts.js';\nimport { providerLabel } from '../agents/providerLabels.js';",
);
replace(
  'src/utils/providerUtils.ts',
  "  return `${provider === 'codex' ? 'Codex' : 'Claude'} is unavailable on this host. Try again later or contact the bot owner.`;",
  "  return `${providerLabel(provider)} is unavailable on this host. Try again later or contact the bot owner.`;",
);

// Avoid eager configuration loading when pure permission helpers are imported in tests.
write('src/utils/permissions.ts', `import { GuildMember } from 'discord.js';

function configuredRoleIds(): string[] {
  return (process.env.AUTHORIZED_ROLE_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
}

export function isAuthorized(
  member: GuildMember | null | undefined,
  authorizedRoleIds: readonly string[] = configuredRoleIds(),
): boolean {
  if (!member) return false;
  return authorizedRoleIds.some(roleId => member.roles.cache.has(roleId));
}
`);

// Preserve valid JSON when command output was structurally serialized before event redaction.
replace(
  'src/utils/redaction.ts',
  "export function safeStringify(value: unknown): string {\n  return JSON.stringify(redactSensitiveValue(value));\n}",
  "export function safeStringify(value: unknown): string {\n  return JSON.stringify(redactSensitiveValue(value));\n}\n\nexport function redactStructuredText(text: string): string {\n  try {\n    return safeStringify(JSON.parse(text));\n  } catch {\n    return redactSensitiveText(text);\n  }\n}",
);
replace(
  'src/utils/redaction.ts',
  "        ...(event.output ? { output: redactSensitiveText(event.output) } : {}),",
  "        ...(event.output ? { output: redactStructuredText(event.output) } : {}),",
);

// Secure onboarding remains bot/message-bound, now for every registered provider.
replace(
  'src/services/providerOnboarding.ts',
  "import type { AgentProviderId } from '../agents/contracts.js';",
  "import { AGENT_PROVIDER_IDS, isAgentProviderId, type AgentProviderId } from '../agents/contracts.js';\nimport { providerLabel } from '../agents/providerLabels.js';",
);
replaceAll(
  'src/services/providerOnboarding.ts',
  "new Set(['claude', 'codex'].map(provider => `${SETUP_BUTTON_PREFIX}${provider}`))",
  "new Set(AGENT_PROVIDER_IDS.map(provider => `${SETUP_BUTTON_PREFIX}${provider}`))",
);
replace(
  'src/services/providerOnboarding.ts',
  "    const provider = interaction.customId.slice(SETUP_BUTTON_PREFIX.length) as AgentProviderId;\n    if (!input.providers.list().includes(provider)) {",
  "    const providerValue = interaction.customId.slice(SETUP_BUTTON_PREFIX.length);\n    if (!isAgentProviderId(providerValue)) {\n      await interaction.reply({ content: 'That provider selection is invalid.', ephemeral: true });\n      return true;\n    }\n    const provider = providerValue;\n    if (!input.providers.list().includes(provider)) {",
);
replace(
  'src/services/providerOnboarding.ts',
  "\nfunction providerLabel(provider: AgentProviderId): string {\n  return provider === 'codex' ? 'Codex' : 'Claude';\n}\n",
  '\n',
);

// Settings UI provider/model mapping.
replace(
  'src/commands/settings.ts',
  "import { AGENT_PROVIDER_IDS, type AgentProviderId, type ProviderAvailability } from '../agents/contracts.js';",
  "import { AGENT_PROVIDER_IDS, type AgentProviderId, type ProviderAvailability } from '../agents/contracts.js';\nimport { providerLabel } from '../agents/providerLabels.js';",
);
replace(
  'src/commands/settings.ts',
  "  codex: ['gpt-5-codex', 'gpt-5-codex-mini', 'gpt-5.4'],\n};",
  "  codex: ['gpt-5-codex', 'gpt-5-codex-mini', 'gpt-5.4'],\n  opencode: [],\n};",
);
replace(
  'src/commands/settings.ts',
  "function providerLabel(provider: AgentProviderId): string {\n  return provider === 'codex' ? 'Codex' : 'Claude';\n}\n\n",
  "function modelSettingKey(provider: AgentProviderId): 'claudeModel' | 'codexModel' | 'openCodeModel' {\n  return provider === 'claude' ? 'claudeModel' : provider === 'codex' ? 'codexModel' : 'openCodeModel';\n}\n\n",
);
replaceAll(
  'src/commands/settings.ts',
  "provider === 'claude' ? 'claudeModel' : 'codexModel'",
  'modelSettingKey(provider)',
);
replaceAll(
  'src/commands/settings.ts',
  "parsed.provider === 'claude' ? 'claudeModel' : 'codexModel'",
  'modelSettingKey(parsed.provider)',
);
replace(
  'src/commands/settings.ts',
  "       'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\n       `Codex status:",
  "       'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\n       'OpenCode default model: ' + (current.openCodeModel ?? 'host/provider default'),\n       `Codex status:",
);
replace(
  'src/commands/settings.ts',
  "    const currentModel = current[provider === 'claude' ? 'claudeModel' : 'codexModel'];\n    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelMenu(`settings:g:model:${provider}`, provider, currentModel)));",
  "    const currentModel = current[modelSettingKey(provider)];\n    if (MODEL_CHOICES[provider].length > 0 || currentModel) {\n      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelMenu(`settings:g:model:${provider}`, provider, currentModel)));\n    }",
);
replace(
  'src/commands/settings.ts',
  "  const clearModelButtons = AGENT_PROVIDER_IDS\n    .filter(provider => Boolean(current[provider === 'claude' ? 'claudeModel' : 'codexModel']))",
  "  const clearModelButtons = AGENT_PROVIDER_IDS\n    .filter(provider => Boolean(current[modelSettingKey(provider)]))",
);
replace(
  'src/commands/settings.ts',
  "  components.push(\n    new ActionRowBuilder<ButtonBuilder>().addComponents(\n      ...modelButtons,\n      new ButtonBuilder().setCustomId('settings:g:pm-model').setLabel('PM model').setStyle(ButtonStyle.Secondary),\n      new ButtonBuilder().setCustomId('settings:g:timeout').setLabel('Claude timeout').setStyle(ButtonStyle.Secondary),\n      new ButtonBuilder().setCustomId('settings:g:reserve').setLabel('Usage reserve').setStyle(ButtonStyle.Secondary),\n    ),\n  );\n  if (clearModelButtons.length > 0) {\n    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...clearModelButtons));\n  }",
  "  const actionButtons = [\n    ...modelButtons,\n    new ButtonBuilder().setCustomId('settings:g:pm-model').setLabel('PM model').setStyle(ButtonStyle.Secondary),\n    new ButtonBuilder().setCustomId('settings:g:timeout').setLabel('Claude timeout').setStyle(ButtonStyle.Secondary),\n    new ButtonBuilder().setCustomId('settings:g:reserve').setLabel('Usage reserve').setStyle(ButtonStyle.Secondary),\n    ...clearModelButtons,\n  ];\n  for (let index = 0; index < actionButtons.length; index += 5) {\n    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons.slice(index, index + 5)));\n  }",
);

// Project settings support OpenCode without provider-specific branching.
replace(
  'src/commands/projectSettings.ts',
  "import { REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';",
  "import { AGENT_PROVIDER_IDS, REASONING_EFFORTS, type AgentProviderId, type ReasoningEffort } from '../agents/contracts.js';\nimport { providerLabel } from '../agents/providerLabels.js';",
);
replace(
  'src/commands/projectSettings.ts',
  "function providerLabel(provider: AgentProviderId): string {\n  return provider === 'codex' ? 'Codex' : 'Claude';\n}\n\nfunction currentModel(settings: ReturnType<SettingsService['project']>, provider: AgentProviderId): string | undefined {\n  return provider === 'claude' ? settings.claudeModel : settings.codexModel;\n}",
  "function modelSettingKey(provider: AgentProviderId): 'claudeModel' | 'codexModel' | 'openCodeModel' {\n  return provider === 'claude' ? 'claudeModel' : provider === 'codex' ? 'codexModel' : 'openCodeModel';\n}\n\nfunction currentModel(settings: ReturnType<SettingsService['project']>, provider: AgentProviderId): string | undefined {\n  return settings[modelSettingKey(provider)];\n}",
);
replace(
  'src/commands/projectSettings.ts',
  "    ...(['claude', 'codex'] as const)",
  '    ...AGENT_PROVIDER_IDS',
);
replace(
  'src/commands/projectSettings.ts',
  "        `Codex model: \\`${current.codexModel ?? 'provider default'}\\``,\n        `Codex reasoning:",
  "        `Codex model: \\`${current.codexModel ?? 'provider default'}\\``,\n        `OpenCode model: \\`${current.openCodeModel ?? 'provider default'}\\``,\n        `Codex reasoning:",
);

// Runtime registration and PM activation for OpenCode, preserving PR16 lifecycle services.
replace(
  'src/services/runtime.ts',
  "import { CodexPrimaryModel } from '../agents/codex/codexPrimaryModel.js';",
  "import { CodexPrimaryModel } from '../agents/codex/codexPrimaryModel.js';\nimport { OpenCodeAcpTransport } from '../agents/opencode/acpTransport.js';\nimport { OpenCodePrimaryModel } from '../agents/opencode/opencodePrimaryModel.js';\nimport { OpenCodeProvider } from '../agents/opencode/opencodeProvider.js';",
);
replace(
  'src/services/runtime.ts',
  "  codexProvider?: AgentProvider;\n  disableClaude?: boolean;",
  "  codexProvider?: AgentProvider;\n  openCodeProvider?: AgentProvider;\n  disableClaude?: boolean;",
);
replace(
  'src/services/runtime.ts',
  "  disableCodex?: boolean;\n  primaryModel?: PrimaryModel;",
  "  disableCodex?: boolean;\n  disableOpenCode?: boolean;\n  primaryModel?: PrimaryModel;",
);
replace(
  'src/services/runtime.ts',
  "  let codexProvider = options.codexProvider;\n  let usageUnsubscribe",
  "  let codexProvider = options.codexProvider;\n  let openCodeProvider = options.openCodeProvider;\n  let usageUnsubscribe",
);
replace(
  'src/services/runtime.ts',
  "    if (codexProvider) {\n      if (codexProvider.id !== 'codex') throw new Error(`Runtime expected a Codex provider, received \"${codexProvider.id}\"`);\n      providers.register(codexProvider);\n    }\n\n    const settingsService",
  "    if (codexProvider) {\n      if (codexProvider.id !== 'codex') throw new Error(`Runtime expected a Codex provider, received \"${codexProvider.id}\"`);\n      providers.register(codexProvider);\n    }\n\n    if (openCodeProvider && openCodeProvider.id !== 'opencode') {\n      throw new Error(`Runtime expected an OpenCode provider, received \"${openCodeProvider.id}\"`);\n    }\n    if (!options.disableOpenCode) {\n      if (!openCodeProvider && config.openCodeEnabled) {\n        openCodeProvider = new OpenCodeProvider({\n          cliPath: config.openCodeCliPath,\n          timeoutMs: config.openCodeTimeoutMs,\n          defaultModel: config.defaultOpenCodeModel || undefined,\n          createConnection: handlers => Promise.resolve(new OpenCodeAcpTransport({\n            cliPath: config.openCodeCliPath,\n            handlers,\n          })),\n        });\n      }\n      if (openCodeProvider) {\n        try {\n          const availability = await openCodeProvider.checkAvailability();\n          if (availability.available) providers.register(openCodeProvider);\n          else console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(availability.reason ?? 'OpenCode provider is unavailable'));\n        } catch (error) {\n          console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(error));\n        }\n      }\n    }\n\n    const settingsService",
);
replace(
  'src/services/runtime.ts',
  "        codexModel: config.defaultCodexModel || undefined,\n        primaryAgentModel:",
  "        codexModel: config.defaultCodexModel || undefined,\n        openCodeModel: config.defaultOpenCodeModel || undefined,\n        primaryAgentModel:",
);
replace(
  'src/services/runtime.ts',
  "        const configuredModel = provider === 'claude' ? globalSettings.claudeModel : globalSettings.codexModel;",
  "        const configuredModel = provider === 'claude'\n          ? globalSettings.claudeModel\n          : provider === 'codex'\n            ? globalSettings.codexModel\n            : globalSettings.openCodeModel;",
);
replace(
  'src/services/runtime.ts',
  "          providerDefaultModel: (provider === 'claude' ? config.defaultModel : config.defaultCodexModel) || undefined,",
  "          providerDefaultModel: (provider === 'claude'\n            ? config.defaultModel\n            : provider === 'codex'\n              ? config.defaultCodexModel\n              : config.defaultOpenCodeModel) || undefined,",
);
replace(
  'src/services/runtime.ts',
  "        if (provider === 'codex' && codexTransport && codexAuth) {\n          return new CodexPrimaryModel({\n            transport: codexTransport,\n            auth: codexAuth,\n            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),\n            ...(configuredReasoning ? { reasoningEffort: configuredReasoning } : {}),\n          });\n        }\n        return undefined;",
  "        if (provider === 'codex' && codexTransport && codexAuth) {\n          return new CodexPrimaryModel({\n            transport: codexTransport,\n            auth: codexAuth,\n            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),\n            ...(configuredReasoning ? { reasoningEffort: configuredReasoning } : {}),\n          });\n        }\n        if (provider === 'opencode' && providers.list().includes('opencode')) {\n          return new OpenCodePrimaryModel({\n            cliPath: config.openCodeCliPath,\n            timeoutMs: config.openCodeTimeoutMs,\n            ...(primaryAgentModel ? { model: primaryAgentModel } : {}),\n          });\n        }\n        return undefined;",
);

// Documentation describes all adapters accurately.
replace(
  'README.md',
  'Discord Agent provides a provider-neutral runtime with executable Claude and Codex providers. Codex runs through the local App Server protocol with guided device-code authentication, streamed events, approvals, questions, cancellation, quota state, and confirmed sibling-thread handoffs.',
  'Discord Agent provides a provider-neutral runtime with executable Claude, Codex, and OpenCode provider-specific adapters. Claude uses the Agent SDK, Codex uses the local App Server protocol, and OpenCode uses the local ACP CLI behind the same durable task contract.',
);
replace(
  'README.md',
  '- **Claude and Codex adapters** — Claude uses the Agent SDK; Codex uses the local App Server JSONL protocol behind the same provider contract.',
  '- **Claude, Codex, and OpenCode adapters** — provider-specific transports feed the same durable provider contract and normalized event model.',
);
replace(
  'AGENTS.md',
  'Discord Agent is a provider-neutral Discord orchestration runtime derived from DiscordClaude. Codex executes through `ClaudeProvider`; Codex executes through the local App Server transport, authentication service, event adapter, and `CodexProvider`.',
  'Discord Agent is a provider-neutral Discord orchestration runtime derived from DiscordClaude. Claude executes through `ClaudeProvider`; Codex executes through the local App Server transport, authentication service, event adapter, and `CodexProvider`; OpenCode executes through ACP and `OpenCodeProvider`.',
);
replace(
  'AGENTS.md',
  '- Anthropic Codex Agent SDK in `src/agents/Codex/`',
  '- Anthropic Claude Agent SDK in `src/agents/claude/`\n- OpenCode ACP transport in `src/agents/opencode/`',
);
replace(
  'AGENTS.md',
  'ProviderRegistry resolves complete Codex and Codex implementations.',
  'ProviderRegistry resolves complete Claude, Codex, and OpenCode implementations.',
);

// Update imported OpenCode fixtures to the stronger PR16 runtime boundaries.
replace(
  'src/services/runtime.test.ts',
  "process.env.AUTHORIZED_ROLE_IDS = 'role';",
  "process.env.AUTHORIZED_ROLE_IDS = 'role';\nprocess.env.AUTHORIZED_USER_ID = 'owner';",
);
replace(
  'src/services/runtime.opencode-primary.test.ts',
  "import type { Client } from 'discord.js';",
  "import { PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';",
);
replace(
  'src/services/runtime.opencode-primary.test.ts',
  "      members: { me: { id: 'bot-1' } },",
  "      members: { me: { id: 'bot-1', permissions: new PermissionsBitField([\n        PermissionFlagsBits.ViewChannel,\n        PermissionFlagsBits.SendMessages,\n        PermissionFlagsBits.ReadMessageHistory,\n        PermissionFlagsBits.CreatePublicThreads,\n        PermissionFlagsBits.SendMessagesInThreads,\n        PermissionFlagsBits.ManageChannels,\n      ]) } },",
);
replace(
  'src/services/runtime.opencode-primary.test.ts',
  "    const client = {\n      guilds:",
  "    const client = {\n      user: { id: 'bot-1' },\n      guilds:",
);

write('src/services/providerOnboarding.opencode.test.ts', `import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import type { AgentProvider, AgentProviderId } from '../agents/contracts.js';
import { createProviderOnboardingService } from './providerOnboarding.js';

function provider(id: AgentProviderId): AgentProvider {
  return {
    id,
    checkAvailability: vi.fn(async () => ({ available: true })),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(async () => undefined),
    estimateHandoff: vi.fn(async () => ({ estimatedInputTokens: 1, confidence: 'low', explanation: 'test' })),
  } as never;
}

describe('provider onboarding with OpenCode PM support', () => {
  it('offers and persists OpenCode as a PM provider', async () => {
    const values = new Map<string, string>();
    const global = () => ({ defaultProvider: values.get('default_provider') as AgentProviderId | undefined });
    const settings = {
      global,
      updateGlobalWithActivation: vi.fn(async (input: { defaultProvider?: AgentProviderId }, activate: () => Promise<void>) => {
        await activate();
        if (input.defaultProvider) values.set('default_provider', input.defaultProvider);
        return global();
      }),
    };
    const metadata = {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => { values.set(key, value); },
    };
    const providers = new ProviderRegistry();
    providers.register(provider('opencode'));
    let sentMessage: any;
    const channel = {
      id: 'agent-chat',
      send: vi.fn(async (payload: any) => {
        sentMessage = {
          id: 'setup-message',
          channelId: 'agent-chat',
          author: { id: 'bot', bot: true },
          content: payload.content,
          components: payload.components.map((row: any) => row.toJSON()),
          edit: vi.fn(async () => undefined),
        };
        return sentMessage;
      }),
      messages: { fetch: vi.fn(async () => null) },
    };
    const onSelected = vi.fn(async () => undefined);
    const service = createProviderOnboardingService({
      ownerId: 'owner',
      settings: settings as never,
      metadata,
      providers,
      channel: channel as never,
      botUserId: 'bot',
      onSelected,
    });

    await service.ensurePrompt();
    const payload = channel.send.mock.calls[0][0] as any;
    const customIds = payload.components.flatMap((row: any) => row.toJSON().components.map((component: any) => component.custom_id));
    expect(customIds).toContain('provider_setup:opencode');

    const update = vi.fn(async () => undefined);
    await expect(service.handleButton({
      customId: 'provider_setup:opencode',
      user: { id: 'owner' },
      channelId: 'agent-chat',
      message: sentMessage,
      update,
      reply: vi.fn(async () => undefined),
    } as never)).resolves.toBe(true);

    expect(onSelected).toHaveBeenCalledWith('opencode');
    expect(global().defaultProvider).toBe('opencode');
  });
});
`);

console.log('[reconcile] PR16/OpenCode reconciliation complete');

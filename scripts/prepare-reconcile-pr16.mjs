import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/reconcile-pr16.mjs';
let source = readFileSync(path, 'utf8');
const broad = `replaceAll(
  'src/commands/settings.ts',
  "provider === 'claude' ? 'claudeModel' : 'codexModel'",
  'modelSettingKey(provider)',
);
replaceAll(
  'src/commands/settings.ts',
  "parsed.provider === 'claude' ? 'claudeModel' : 'codexModel'",
  'modelSettingKey(parsed.provider)',
);`;
const precise = `replace(
  'src/commands/settings.ts',
  "  const providerModelKey = provider === 'claude' ? 'claudeModel' : 'codexModel';",
  "  const providerModelKey = modelSettingKey(provider);",
);
replace(
  'src/commands/settings.ts',
  "        const key = parsed.provider === 'claude' ? 'claudeModel' : 'codexModel';",
  "        const key = modelSettingKey(parsed.provider);",
);
replace(
  'src/commands/settings.ts',
  "        const model = validateModelSelection(value, parsed.provider, dependencies.settings.global()[parsed.provider === 'claude' ? 'claudeModel' : 'codexModel']);",
  "        const model = validateModelSelection(value, parsed.provider, dependencies.settings.global()[modelSettingKey(parsed.provider)]);",
);
replace(
  'src/commands/settings.ts',
  "        changeResult = await persistGlobalModel(dependencies, { [parsed.provider === 'claude' ? 'claudeModel' : 'codexModel']: model }, parsed.provider);",
  "        changeResult = await persistGlobalModel(dependencies, { [modelSettingKey(parsed.provider)]: model }, parsed.provider);",
);
replace(
  'src/commands/settings.ts',
  "        changeResult = await persistGlobalModel(dependencies, { [parsed.provider === 'claude' ? 'claudeModel' : 'codexModel']: model ?? '' }, parsed.provider);",
  "        changeResult = await persistGlobalModel(dependencies, { [modelSettingKey(parsed.provider)]: model ?? '' }, parsed.provider);",
);`;
if (!source.includes(broad)) throw new Error('Broad settings transformation block not found');
source = source.replace(broad, precise);
source = source.replace(
  "  \"       'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\\n       `Codex status:\"",
  "  \"      'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\\n      `Codex status:\"",
).replace(
  "  \"       'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\\n       'OpenCode default model: ' + (current.openCodeModel ?? 'host/provider default'),\\n       `Codex status:\"",
  "  \"      'Codex default model: ' + (current.codexModel ?? 'host/provider default'),\\n      'OpenCode default model: ' + (current.openCodeModel ?? 'host/provider default'),\\n      `Codex status:\"",
);
source = source.replace(
  `replace(
  'AGENTS.md',
  'ProviderRegistry resolves complete Codex and Codex implementations.',
  'ProviderRegistry resolves complete Claude, Codex, and OpenCode implementations.',
);`,
  `replace(
  'AGENTS.md',
  '\`ProviderRegistry\` resolves complete Codex and Codex implementations. Codex is registered only when the local App Server initializes successfully and authoritative account state is available.',
  '\`ProviderRegistry\` resolves complete Claude, Codex, and OpenCode implementations. Providers are registered only after their complete lifecycle and authoritative availability checks succeed.',
);`,
);
const finalMarker = "console.log('[reconcile] PR16/OpenCode reconciliation complete');";
if (!source.includes(finalMarker)) throw new Error('Final reconciliation marker not found');
source = source.replace(finalMarker, `// Discord documented SET_VOICE_CHANNEL_STATUS after the current discord.js release; preserve the real API bit locally.
replace(
  'src/discord/capabilities/contracts.ts',
  "export type PermissionName = keyof typeof PermissionFlagsBits;",
  "export type PermissionName = keyof typeof PermissionFlagsBits | 'SetVoiceChannelStatus';",
);
replace(
  'src/discord/capabilities/registry.ts',
  "import type { DiscordCapabilityDefinition } from './contracts.js';",
  "import type { DiscordCapabilityDefinition, PermissionName } from './contracts.js';",
);
replace(
  'src/discord/capabilities/registry.ts',
  "export const PROCESS_GATEWAY_INTENTS = ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers'] as const;",
  "export const PROCESS_GATEWAY_INTENTS = ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers'] as const;\\n\\nconst SET_VOICE_CHANNEL_STATUS_PERMISSION = 1n << 48n;\\n\\nexport function permissionBit(permission: PermissionName): bigint {\\n  return permission === 'SetVoiceChannelStatus'\\n    ? SET_VOICE_CHANNEL_STATUS_PERMISSION\\n    : PermissionFlagsBits[permission];\\n}",
);
replace(
  'src/discord/capabilities/registry.ts',
  "export function permissionBitsFor(names: readonly (keyof typeof PermissionFlagsBits)[]): bigint {\\n  return names.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);\\n}",
  "export function permissionBitsFor(names: readonly PermissionName[]): bigint {\\n  return names.reduce((bits, name) => bits | permissionBit(name), 0n);\\n}",
);
replace(
  'src/discord/capabilities/registry.ts',
  "  return permission ? PermissionFlagsBits[permission] : undefined;",
  "  return permission ? permissionBit(permission) : undefined;",
);
replace(
  'src/discord/capabilities/evaluator.ts',
  "import { getCapability } from './registry.js';",
  "import { getCapability, permissionBitForCapability } from './registry.js';",
);
replace(
  'src/discord/capabilities/evaluator.ts',
  "  if (capability.scope === 'guild') {\\n    return context.member.permissions.has(capability.permission)",
  "  const permissionBit = permissionBitForCapability(capability.id)!;\\n  if (capability.scope === 'guild') {\\n    return context.member.permissions.has(permissionBit)",
);
replace(
  'src/discord/capabilities/evaluator.ts',
  "  return permissions.has(capability.permission)",
  "  return permissions.has(permissionBit)",
);
replace(
  'src/discord/capabilities/registry.test.ts',
  "import { CAPABILITIES } from './registry.js';",
  "import { CAPABILITIES, permissionBitForCapability } from './registry.js';",
);
replace(
  'src/discord/capabilities/registry.test.ts',
  "        expect(PermissionFlagsBits[capability.permission]).toBeTypeOf('bigint');",
  "        expect(permissionBitForCapability(capability.id)).toBeTypeOf('bigint');",
);
replace(
  'src/services/providerOnboarding.opencode.test.ts',
  "          components: payload.components.map((row: any) => row.toJSON()),",
  "          components: payload.components.map((row: any) => {\\n            const json = row.toJSON();\\n            return {\\n              components: json.components.map((component: any) => ({\\n                customId: component.custom_id,\\n                type: component.type,\\n                style: component.style,\\n                label: component.label,\\n              })),\\n            };\\n          }),",
);

console.log('[reconcile] PR16/OpenCode reconciliation complete');`);
writeFileSync(path, source);
console.log('[prepare] narrowed settings transformations');
await import('./reconcile-pr16.mjs');

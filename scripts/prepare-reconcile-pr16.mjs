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
writeFileSync(path, source);
console.log('[prepare] narrowed settings transformations');
await import('./reconcile-pr16.mjs');

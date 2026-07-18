import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/reconcile-pr16.mjs';
let source = readFileSync(path, 'utf8');
const marker = "console.log('[reconcile] PR16/OpenCode reconciliation complete');";
if (!source.includes(marker)) throw new Error('Final reconciliation marker not found');
source = source.replace(marker, `replace(
  'src/services/channelManager.ts',
  "import { getCapability, permissionBitForCapability } from '../discord/capabilities/registry.js';",
  "import { getCapability, permissionBit, permissionBitForCapability } from '../discord/capabilities/registry.js';",
);
replaceAll(
  'src/services/channelManager.ts',
  "permissions?.has?.(permission)",
  "permissions?.has?.(permissionBit(permission))",
);
replaceAll(
  'src/services/channelManager.ts',
  "channelPermissions?.has?.(permission)",
  "channelPermissions?.has?.(permissionBit(permission))",
);
replaceAll(
  'src/services/channelManager.ts',
  "ownerPermissions?.has?.(permission)",
  "ownerPermissions?.has?.(permissionBit(permission))",
);

console.log('[reconcile] PR16/OpenCode reconciliation complete');`);
writeFileSync(path, source);
console.log('[prepare-build] added bigint permission checks');
await import('./prepare-reconcile-pr16.mjs');

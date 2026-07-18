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
replace(
  'src/services/channelManager.ts',
  "  const missingPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));",
  "  const missingPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permissionBit(permission)) ?? false));",
);
replace(
  'src/services/channelManager.ts',
  "    .filter(permission => botMember.permissions?.has?.(permission) ?? false)\\n    .map(permission => permissionBitForCapability(",
  "    .filter(permission => botMember.permissions?.has?.(permissionBit(permission)) ?? false)\\n    .map(permission => permissionBitForCapability(",
);
replace(
  'src/services/channelManager.ts',
  "  const missingBootstrapPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));",
  "  const missingBootstrapPermissions = bootstrap.permissionNames.filter(permission => !(botMember.permissions?.has?.(permissionBit(permission)) ?? false));",
);
replace(
  'src/services/channelManager.ts',
  "  const missingGuildPermissions = requiredPermissions.filter(permission => !(botMember.permissions?.has?.(permission) ?? false));",
  "  const missingGuildPermissions = requiredPermissions.filter(permission => !(botMember.permissions?.has?.(permissionBit(permission)) ?? false));",
);
replace(
  'src/services/channelManager.ts',
  "    const missingChannelPermissions = requiredPermissions.filter(permission => !(channelPermissions?.has?.(permission) ?? false));",
  "    const missingChannelPermissions = requiredPermissions.filter(permission => !(channelPermissions?.has?.(permissionBit(permission)) ?? false));",
);
replace(
  'src/services/channelManager.ts',
  "      const missingOwnerPermissions = requiredPermissions.filter(permission => !(ownerPermissions?.has?.(permission) ?? false));",
  "      const missingOwnerPermissions = requiredPermissions.filter(permission => !(ownerPermissions?.has?.(permissionBit(permission)) ?? false));",
);

console.log('[reconcile] PR16/OpenCode reconciliation complete');`);
writeFileSync(path, source);
console.log('[prepare-build] added precise bigint permission checks');
await import('./prepare-reconcile-pr16.mjs');

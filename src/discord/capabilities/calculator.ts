import { calculateCombinedSetupProfile, calculateProfile } from './profiles.js';
import { CAPABILITIES, PROCESS_GATEWAY_INTENTS } from './registry.js';

function formatBits(bits: bigint): string {
  return bits.toString(10);
}

function printProfile(label: string, profile: ReturnType<typeof calculateProfile>): void {
  console.log(`${label} permission names:`);
  console.log(profile.permissionNames.length ? profile.permissionNames.join(', ') : '(none)');
  console.log(`${label} permissions integer: ${formatBits(profile.permissionBits)}`);
}

const runtime = calculateProfile('runtime');
const bootstrap = calculateProfile('bootstrap');
const setup = calculateCombinedSetupProfile();

console.log('Discord Agent least-privilege capability calculator');
console.log('Permission bits are distinct from Gateway intents and application configuration.');
printProfile('Runtime', runtime);
printProfile('Bootstrap', bootstrap);
console.log(`Combined setup permissions integer: ${formatBits(setup.permissionBits)}`);
console.log(`Gateway intents configured for the process: ${PROCESS_GATEWAY_INTENTS.join(', ')}`);
console.log('Application-command/OAuth scopes: bot, applications.commands');
console.log('Application features (not bot permission requirements): embedded Activities and interaction APIs (buttons, selects, modals, context commands).');
console.log('Optional represented capabilities:');
for (const capability of CAPABILITIES.filter(item => item.requirement === 'optional' || item.requirement === 'future_application_feature')) {
  console.log(`- ${capability.id}: ${capability.permission ?? capability.applicationFeature ?? 'application configuration only'}`);
}
if (process.env.DISCORD_CLIENT_ID) {
  const query = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    scope: 'bot applications.commands',
    permissions: formatBits(setup.permissionBits),
  });
  console.log(`OAuth installation URL (bootstrap): https://discord.com/oauth2/authorize?${query.toString()}`);
}
console.log('Administrator is intentionally absent and is neither required nor recommended.');

import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_CAPABILITY_PROFILES } from '../discord/capabilities/profiles.js';
import { evaluateCapabilities, type CapabilityPermissionChannel } from '../discord/capabilities/evaluator.js';
import { formatCapabilityReport } from '../discord/capabilities/report.js';
import { CAPABILITIES, PROCESS_GATEWAY_INTENTS } from '../discord/capabilities/registry.js';

export async function handleCapabilities(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This diagnostic is only available inside the configured Discord server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const channel = interaction.channel as unknown as CapabilityPermissionChannel | null;
  const capabilityIds = [...new Set([
    ...DISCORD_CAPABILITY_PROFILES.runtime,
    ...DISCORD_CAPABILITY_PROFILES.bootstrap,
    ...DISCORD_CAPABILITY_PROFILES.optional,
    ...CAPABILITIES.filter(capability => capability.requirement === 'future_application_feature').map(capability => capability.id),
  ])];
  const report = evaluateCapabilities(capabilityIds, {
    member,
    channel,
    configuredIntents: PROCESS_GATEWAY_INTENTS,
  });

  const configuration = [
    `Configured Gateway intents: ${PROCESS_GATEWAY_INTENTS.join(', ')}.`,
    'OAuth/application scopes: bot and applications.commands; no token or credential state is shown.',
    'Application features: buttons, selects, modals, context commands, and Activities are configured through Discord application APIs/settings, not baseline bot-role permission boxes.',
  ].join('\n');
  await interaction.reply({
    content: `${formatCapabilityReport(report)}\n${configuration}`,
    flags: MessageFlags.Ephemeral,
  });
}

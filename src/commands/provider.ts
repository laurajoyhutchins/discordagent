import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { Project } from '../types.js';
import { activatePrimaryProvider, capturePrimaryProviderState, getPrimaryChannelId, getPrimaryOwnerId, getProviderRegistry, getSettingsService, maybeGetProviderOnboardingService } from '../services/agentRuntimeService.js';
import type { PrimaryProviderActivationResult } from '../services/agentRuntimeService.js';
import {
  getProjectByChannel,
  getDefaultProvider,
} from '../services/projectStore.js';
import type { SettingsService } from '../services/settingsService.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface ProviderCommandDependencies {
  getProjectByChannel(channelId: string): Project | undefined;
  settings: Pick<SettingsService, 'updateProject' | 'updateGlobalWithActivation'>;
  getDefaultProvider(): AgentProviderId | undefined;
  activateDefaultProvider?(provider: AgentProviderId): Promise<PrimaryProviderActivationResult | void>;
  captureDefaultProviderState?(): () => void;
  reconcileProviderOnboarding?(): Promise<void>;
  primaryChannelId?: string;
  primaryOwnerId?: string;
  checkProvider(provider: AgentProviderId): Promise<{ available: boolean; reason?: string; authenticationRequired?: boolean }>;
}

function defaultDependencies(): ProviderCommandDependencies {
  return {
  getProjectByChannel,
  getDefaultProvider,
  activateDefaultProvider: activatePrimaryProvider,
  captureDefaultProviderState: capturePrimaryProviderState,
  reconcileProviderOnboarding: async () => { await maybeGetProviderOnboardingService()?.ensurePrompt(); },
    primaryChannelId: optionalPrimary(getPrimaryChannelId),
    primaryOwnerId: optionalPrimary(getPrimaryOwnerId),
  settings: getSettingsService(),
  checkProvider: async provider => {
    const registry = getProviderRegistry();
    if (!registry.list().includes(provider)) {
      return { available: false, reason: `${provider === 'codex' ? 'Codex' : 'Claude'} is unavailable on this host.` };
    }
    return registry.availability(provider);
  },
  };
}

function optionalPrimary(read: () => string): string | undefined {
  try { return read(); } catch { return undefined; }
}

function providerUnavailable(provider: AgentProviderId): string {
  return `${provider === 'codex' ? 'Codex' : 'Claude'} is unavailable on this host. Try again later or contact the bot owner.`;
}

async function safeProviderCheck(
  dependencies: ProviderCommandDependencies,
  provider: AgentProviderId,
): Promise<{ available: boolean }> {
  try {
    const result = await dependencies.checkProvider(provider);
    return { available: result.available };
  } catch (error) {
    console.error(`[provider] Availability check failed for ${provider}:`, redactErrorMessage(error));
    return { available: false };
  }
}

export async function handleProvider(
  interaction: ChatInputCommandInteraction,
  dependencies: ProviderCommandDependencies = defaultDependencies(),
): Promise<void> {
  if (interaction.channel?.isThread()) {
    await interaction.reply({
      content: 'A task thread keeps the provider it started with. Use `/provider claude` or `/provider codex` as a text command in this task thread to request a confirmed sibling handoff.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requested = interaction.options.getString('provider') as AgentProviderId | null;
  const project = dependencies.getProjectByChannel(interaction.channelId);
  const channelName = interaction.channel && 'name' in interaction.channel ? interaction.channel.name : undefined;
  if (!project && dependencies.primaryChannelId === interaction.channelId && dependencies.primaryOwnerId === interaction.user.id) {
    if (!requested) {
      const selected = dependencies.getDefaultProvider();
      await interaction.reply({
        content: selected ? `Global default provider: \`${selected}\`.` : 'No global provider is selected yet. Choose one from the setup buttons above.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const availability = await safeProviderCheck(dependencies, requested);
    if (!availability.available) {
      await interaction.reply({ content: providerUnavailable(requested), flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await dependencies.settings.updateGlobalWithActivation({ defaultProvider: requested }, async () => {
        await dependencies.activateDefaultProvider?.(requested);
      }, dependencies.captureDefaultProviderState?.());
    } catch (error) {
      console.error('[provider] Global provider activation failed:', redactErrorMessage(error));
      await interaction.reply({
        content: 'The global provider could not be changed. Try again later or contact the bot owner.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await dependencies.reconcileProviderOnboarding?.();
    await interaction.reply({
      content: `Global default provider set to **${requested === 'codex' ? 'Codex' : 'Claude'}**. The PM chat and new projects will use ${requested}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!project || interaction.channelId !== project.agentChannelId) {
    await interaction.reply({
      content: 'This command can only be used in a project channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!requested) {
    await interaction.reply({
      content: `Default provider for **${project.name}**: \`${project.defaultProvider}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const availability = await safeProviderCheck(dependencies, requested);
  if (!availability.available) {
    await interaction.reply({ content: providerUnavailable(requested), flags: MessageFlags.Ephemeral });
    return;
  }

  dependencies.settings.updateProject(project.name, { defaultProvider: requested });
  await interaction.reply({
    content: `Default provider for **${project.name}** set to **${requested === 'codex' ? 'Codex' : 'Claude'}**. New task threads will use ${requested}.`,
    flags: MessageFlags.Ephemeral,
  });
}

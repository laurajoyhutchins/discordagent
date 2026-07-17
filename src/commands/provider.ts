import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { Project } from '../types.js';
import { activatePrimaryProvider, getProviderRegistry } from '../services/agentRuntimeService.js';
import {
  getProjectByChannel,
  getDefaultProvider,
  updateDefaultProvider,
  updateProjectProvider,
} from '../services/projectStore.js';

export interface ProviderCommandDependencies {
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectProvider(name: string, provider: AgentProviderId): void;
  getDefaultProvider(): AgentProviderId | undefined;
  updateDefaultProvider(provider: AgentProviderId): void;
  activateDefaultProvider?(provider: AgentProviderId): Promise<void>;
  checkProvider(provider: AgentProviderId): Promise<{ available: boolean; reason?: string; authenticationRequired?: boolean }>;
}

const defaultDependencies: ProviderCommandDependencies = {
  getProjectByChannel,
  getDefaultProvider,
  updateDefaultProvider,
  activateDefaultProvider: activatePrimaryProvider,
  updateProjectProvider,
  checkProvider: provider => getProviderRegistry().require(provider).checkAvailability(),
};

export async function handleProvider(
  interaction: ChatInputCommandInteraction,
  dependencies: ProviderCommandDependencies = defaultDependencies,
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
  if (!project && channelName === 'agent-chat') {
    if (!requested) {
      const selected = dependencies.getDefaultProvider();
      await interaction.reply({
        content: selected ? `Global default provider: \`${selected}\`.` : 'No global provider is selected yet. Choose one from the setup buttons above.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const availability = await dependencies.checkProvider(requested);
    if (!availability.available) {
      await interaction.reply({ content: availability.reason ?? `Provider ${requested} is unavailable.`, flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await dependencies.activateDefaultProvider?.(requested);
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : String(error),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    dependencies.updateDefaultProvider(requested);
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

  const availability = await dependencies.checkProvider(requested);
  if (!availability.available) {
    await interaction.reply({ content: availability.reason ?? `Provider ${requested} is unavailable.`, flags: MessageFlags.Ephemeral });
    return;
  }

  dependencies.updateProjectProvider(project.name, requested);
  await interaction.reply({
    content: `Default provider for **${project.name}** set to **${requested === 'codex' ? 'Codex' : 'Claude'}**. New task threads will use ${requested}.`,
    flags: MessageFlags.Ephemeral,
  });
}

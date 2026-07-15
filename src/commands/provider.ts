import type { ChatInputCommandInteraction } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { Project } from '../types.js';
import { getProviderRegistry } from '../services/agentRuntimeService.js';
import {
  getProjectByChannel,
  updateProjectProvider,
} from '../services/projectStore.js';

export interface ProviderCommandDependencies {
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectProvider(name: string, provider: AgentProviderId): void;
  checkProvider(provider: AgentProviderId): Promise<{ available: boolean; reason?: string; authenticationRequired?: boolean }>;
}

const defaultDependencies: ProviderCommandDependencies = {
  getProjectByChannel,
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
      ephemeral: true,
    });
    return;
  }

  const project = dependencies.getProjectByChannel(interaction.channelId);
  if (!project || interaction.channelId !== project.agentChannelId) {
    await interaction.reply({
      content: 'This command can only be used in a project channel.',
      ephemeral: true,
    });
    return;
  }

  const requested = interaction.options.getString('provider') as AgentProviderId | null;
  if (!requested) {
    await interaction.reply({
      content: `Default provider for **${project.name}**: \`${project.defaultProvider}\`.`,
      ephemeral: true,
    });
    return;
  }

  const availability = await dependencies.checkProvider(requested);
  if (!availability.available) {
    await interaction.reply({ content: availability.reason ?? `Provider ${requested} is unavailable.`, ephemeral: true });
    return;
  }

  dependencies.updateProjectProvider(project.name, requested);
  await interaction.reply({
    content: `Default provider for **${project.name}** set to **${requested === 'codex' ? 'Codex' : 'Claude'}**. New task threads will use ${requested}.`,
    ephemeral: true,
  });
}

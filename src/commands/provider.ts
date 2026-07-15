import type { ChatInputCommandInteraction } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { Project } from '../types.js';
import {
  getProjectByChannel,
  updateProjectProvider,
} from '../services/projectStore.js';

export interface ProviderCommandDependencies {
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectProvider(name: string, provider: AgentProviderId): void;
}

const defaultDependencies: ProviderCommandDependencies = {
  getProjectByChannel,
  updateProjectProvider,
};

export async function handleProvider(
  interaction: ChatInputCommandInteraction,
  dependencies: ProviderCommandDependencies = defaultDependencies,
): Promise<void> {
  if (interaction.channel?.isThread()) {
    await interaction.reply({
      content: 'A task thread keeps the provider it started with. Change the project default from the main project channel; provider handoff will create a sibling thread in Phase 2.',
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

  if (requested === 'codex') {
    await interaction.reply({
      content: 'Codex App Server support is planned for Phase 2 and is not executable in this foundation release. The project provider was not changed.',
      ephemeral: true,
    });
    return;
  }

  dependencies.updateProjectProvider(project.name, 'claude');
  await interaction.reply({
    content: `Default provider for **${project.name}** set to **Claude**. New task threads will use Claude.`,
    ephemeral: true,
  });
}

import { Interaction, MessageFlags } from 'discord.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { handleAddProject } from '../commands/addProject.js';
import { handleListProjects } from '../commands/listProjects.js';
import { handleRemoveProject } from '../commands/removeProject.js';
import { handleCancel } from '../commands/cancel.js';
import { handleLoop } from '../commands/loop.js';
import { handleStopLoop } from '../commands/stopLoop.js';
import { handleUsage } from '../commands/usage.js';
import { handleAgents } from '../commands/agents.js';
import { handleModel } from '../commands/model.js';
import { handleProvider } from '../commands/provider.js';
import { stopLoopFromButton } from '../services/loopRunner.js';
import { handleCodexAuth, handleCodexAuthButton } from '../commands/codexAuth.js';
import { maybeGetProviderOnboardingService } from '../services/agentRuntimeService.js';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // Handle button interactions (e.g., loop stop button)
  if (interaction.isButton()) {
    if (await maybeGetProviderOnboardingService()?.handleButton(interaction)) return;
    if (await handleCodexAuthButton(interaction)) return;
    if (interaction.customId.startsWith('loop_stop_')) {
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
      if (!isAuthorized(member)) {
        await interaction.reply({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral });
        return;
      }

      const channelId = interaction.customId.replace('loop_stop_', '');
      await stopLoopFromButton(channelId, interaction);
      return;
    }

    // Task-scoped agent components are consumed by InteractionBroker message collectors.
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Auth check
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
  if (!isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized to use this bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'add-project':
        await handleAddProject(interaction);
        break;
      case 'list-projects':
        await handleListProjects(interaction);
        break;
      case 'remove-project':
        await handleRemoveProject(interaction);
        break;
      case 'cancel':
        await handleCancel(interaction);
        break;
      case 'loop':
        await handleLoop(interaction);
        break;
      case 'stop-loop':
        await handleStopLoop(interaction);
        break;
      case 'agents':
        await handleAgents(interaction);
        break;
      case 'usage':
        await handleUsage(interaction);
        break;
      case 'codex-auth':
        await handleCodexAuth(interaction);
        break;
      case 'provider':
        await handleProvider(interaction);
        break;
      case 'model':
        await handleModel(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error(`Error handling command ${interaction.commandName}:`, redactErrorMessage(err));
    const userMsg = 'An unexpected error occurred. Check server logs for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(userMsg).catch(() => {});
    } else {
      await interaction.reply({ content: userMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

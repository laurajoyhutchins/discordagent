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
import { handleTurnIntoTask } from '../commands/turnIntoTask.js';
import { stopLoopFromButton } from '../services/loopRunner.js';
import { handleCodexAuth, handleCodexAuthButton } from '../commands/codexAuth.js';
import { maybeGetProviderOnboardingService } from '../services/agentRuntimeService.js';
import { handleCapabilities } from '../commands/capabilities.js';
import { handleSettings, handleSettingsComponent } from '../commands/settings.js';
import { handleProjectSettings, handleProjectSettingsComponent } from '../commands/projectSettings.js';
import { handleTaskControlButton } from '../discord/taskControlHandler.js';

export async function routeSettingsComponents(
  interaction: Interaction,
  globalHandler: typeof handleSettingsComponent = handleSettingsComponent,
  projectHandler: typeof handleProjectSettingsComponent = handleProjectSettingsComponent,
): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
  if (await globalHandler(interaction as Parameters<typeof handleSettingsComponent>[0])) return true;
  if (interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    if (await projectHandler(interaction as Parameters<typeof handleProjectSettingsComponent>[0])) return true;
  }
  return false;
}

export async function routeTaskControlComponents(
  interaction: Interaction,
  handler: typeof handleTaskControlButton = handleTaskControlButton,
): Promise<boolean> {
  if (!interaction.isButton()) return false;
  return handler(interaction);
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // Settings components are revalidated by their command handlers against the
  // current channel, project, and clicking user before any state changes.
  if (await routeSettingsComponents(interaction)) return;

  if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Turn into task') {
    await handleTurnIntoTask(interaction);
    return;
  }

  // Global settings are owner-only rather than role-only, so these commands
  // must be authorized by their scoped handlers before the generic role gate.
  if (interaction.isChatInputCommand() && interaction.commandName === 'settings') {
    try {
      await handleSettings(interaction);
    } catch (err) {
      console.error('Error handling command settings:', redactErrorMessage(err));
      await interaction.reply({ content: 'The settings panel could not be opened.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }
  if (interaction.isChatInputCommand() && interaction.commandName === 'project-settings') {
    try {
      await handleProjectSettings(interaction);
    } catch (err) {
      console.error('Error handling command project-settings:', redactErrorMessage(err));
      await interaction.reply({ content: 'The project settings panel could not be opened.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  // Handle button interactions (e.g., task controls and loop stop buttons).
  if (interaction.isButton()) {
    if (await maybeGetProviderOnboardingService()?.handleButton(interaction)) return;
    if (await handleCodexAuthButton(interaction)) return;
    if (await routeTaskControlComponents(interaction)) return;
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
      case 'capabilities':
        await handleCapabilities(interaction);
        break;
      case 'settings':
        await handleSettings(interaction);
        break;
      case 'project-settings':
        await handleProjectSettings(interaction);
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
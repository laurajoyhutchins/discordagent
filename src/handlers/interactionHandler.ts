import { Interaction } from 'discord.js';
import { isAuthorized } from '../utils/permissions.js';
import { handleAddProject } from '../commands/addProject.js';
import { handleListProjects } from '../commands/listProjects.js';
import { handleRemoveProject } from '../commands/removeProject.js';
import { handleCancel } from '../commands/cancel.js';
import { handleLoop } from '../commands/loop.js';
import { handleStopLoop } from '../commands/stopLoop.js';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  // Auth check
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
  if (!isAuthorized(member)) {
    await interaction.reply({ content: 'You are not authorized to use this bot.', ephemeral: true });
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
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (err) {
    console.error(`Error handling command ${interaction.commandName}:`, err);
    const userMsg = 'An unexpected error occurred. Check server logs for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(userMsg).catch(() => {});
    } else {
      await interaction.reply({ content: userMsg, ephemeral: true }).catch(() => {});
    }
  }
}

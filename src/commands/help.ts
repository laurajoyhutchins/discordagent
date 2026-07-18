import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { getPrimaryChannelId } from '../services/agentRuntimeService.js';
import { operatorEmbed } from '../discord/presentation.js';

export type HelpContext = 'primary' | 'project' | 'task' | 'workspace';

export interface HelpView {
  context: HelpContext;
  projectName?: string;
}

export function buildHelpEmbed(view: HelpView) {
  const embed = operatorEmbed({
    title: 'Discord Agent help',
    description: contextDescription(view),
    footer: 'Natural language is the main interface. Commands are for inspection and explicit controls.',
  });

  embed.addFields(
    {
      name: 'Start here',
      value: startHere(view),
    },
    {
      name: 'Useful commands',
      value: commandsFor(view),
    },
    {
      name: 'How work moves',
      value: 'Project messages create durable task threads. Replies continue the same task. Provider changes inside a task create a confirmed sibling handoff rather than mutating the active session.',
    },
  );
  return embed;
}

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const view = resolveHelpView(interaction);
  await interaction.reply({ embeds: [buildHelpEmbed(view)], flags: MessageFlags.Ephemeral });
}

function resolveHelpView(interaction: ChatInputCommandInteraction): HelpView {
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const project = channel.parentId ? getProjectByChannel(channel.parentId) : undefined;
    return { context: 'task', ...(project ? { projectName: project.name } : {}) };
  }

  const project = getProjectByChannel(interaction.channelId);
  if (project) return { context: 'project', projectName: project.name };

  try {
    if (interaction.channelId === getPrimaryChannelId()) return { context: 'primary' };
  } catch {
    // Runtime context is optional in tests and during partial startup.
  }

  return { context: 'workspace' };
}

function contextDescription(view: HelpView): string {
  if (view.context === 'primary') {
    return 'This is your primary operator channel. Talk naturally here to review priorities, inspect state, make decisions, or ask the PM agent to scope work.';
  }
  if (view.context === 'project') {
    return `This is the project channel for **${view.projectName ?? 'this project'}**. Send a task in ordinary language and Discord Agent will create an isolated durable task thread.`;
  }
  if (view.context === 'task') {
    return `This is a durable task thread${view.projectName ? ` for **${view.projectName}**` : ''}. Reply here to continue the existing task, answer a question, or use its controls.`;
  }
  return 'Use this view to inspect the workspace and find the right project or operator channel.';
}

function startHere(view: HelpView): string {
  if (view.context === 'primary') return 'Ask what needs attention, discuss a project, or describe work you want scoped. The PM agent will keep routine details concise and surface blockers or expensive choices.';
  if (view.context === 'project') return 'Describe one concrete outcome. A new thread, branch, worktree, provider session, and durable task record are created through the normal coordinator.';
  if (view.context === 'task') return 'Reply with the next instruction. Use **Inspect** for durable details or **Cancel** while the task is active.';
  return 'Run `/list-projects`, then open a project channel. Use `/add-project` when no project has been registered yet.';
}

function commandsFor(view: HelpView): string {
  if (view.context === 'primary') return '`/settings` · `/provider` · `/model` · `/agents` · `/usage` · `/list-projects`';
  if (view.context === 'project') return '`/project-settings` · `/provider` · `/model` · `/loop` · `/capabilities`';
  if (view.context === 'task') return '`/cancel` · `/provider` for a sibling handoff · `/model <name> <prompt>` for one turn';
  return '`/list-projects` · `/add-project` · `/agents` · `/usage` · `/capabilities`';
}

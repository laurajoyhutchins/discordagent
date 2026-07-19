import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { getPrimaryChannelId } from '../services/agentRuntimeService.js';
import { operatorEmbed, operatorReplyPayload } from '../discord/presentation.js';

export type HelpContext = 'primary' | 'project' | 'task' | 'review' | 'workspace';

export interface HelpView {
  context: HelpContext;
  projectName?: string;
  agentChannelId?: string;
}

export function buildHelpEmbed(view: HelpView) {
  return operatorEmbed({
    title: 'Discord Agent help',
    description: contextDescription(view),
    footer: 'Natural language is the main interface. Commands are for inspection and explicit controls.',
  }).addFields(
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
      value: workMoves(view),
    },
  );
}

export function buildHelpText(view: HelpView): string {
  return [
    '**Discord Agent help**',
    contextDescription(view),
    '',
    '**Start here**',
    startHere(view),
    '',
    '**Useful commands**',
    commandsFor(view),
    '',
    '**How work moves**',
    workMoves(view),
  ].join('\n');
}

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const view = resolveHelpView(interaction);
  const payload = await operatorReplyPayload(interaction, {
    embed: buildHelpEmbed(view),
    fallback: buildHelpText(view),
  });
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function resolveHelpView(interaction: ChatInputCommandInteraction): HelpView {
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const parentId = channel.parentId;
    const project = parentId ? getProjectByChannel(parentId) : undefined;
    if (project && parentId === project.agentChannelId) {
      return { context: 'task', projectName: project.name, agentChannelId: project.agentChannelId };
    }
    if (project && parentId === project.roborevChannelId) {
      return { context: 'review', projectName: project.name, agentChannelId: project.agentChannelId };
    }
    return { context: 'workspace' };
  }

  const project = getProjectByChannel(interaction.channelId);
  if (project && interaction.channelId === project.agentChannelId) {
    return { context: 'project', projectName: project.name, agentChannelId: project.agentChannelId };
  }
  if (project && interaction.channelId === project.roborevChannelId) {
    return { context: 'review', projectName: project.name, agentChannelId: project.agentChannelId };
  }

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
  if (view.context === 'review') {
    return `This is the review surface${view.projectName ? ` for **${view.projectName}**` : ''}. RoboRev review notifications appear here; ordinary messages do not start or continue agent tasks.`;
  }
  return 'Use this view to inspect the workspace and find the right project or operator channel.';
}

function startHere(view: HelpView): string {
  if (view.context === 'primary') return 'Ask what needs attention, discuss a project, or describe work you want scoped. The PM agent will keep routine details concise and surface blockers or expensive choices.';
  if (view.context === 'project') return 'Describe one concrete outcome. A new thread, branch, worktree, provider session, and durable task record are created through the normal coordinator.';
  if (view.context === 'task') return 'Reply with the next instruction. Use **Inspect** for durable details or **Cancel** while the task is active.';
  if (view.context === 'review') return `Use ${view.agentChannelId ? `<#${view.agentChannelId}>` : 'the project agent channel'} to start or continue implementation work. Use this channel to inspect review findings and their delivery state.`;
  return 'Run `/list-projects`, then open a project channel. Use `/add-project` when no project has been registered yet.';
}

function commandsFor(view: HelpView): string {
  if (view.context === 'primary') return '`/settings` · `/provider` · `/model` · `/agents` · `/usage` · `/list-projects`';
  if (view.context === 'project') return '`/project-settings` · `/provider` · `/model` · `/loop` · `/capabilities`';
  if (view.context === 'task') return '`/cancel` · `/provider` for a sibling handoff · `/model <name> <prompt>` for one turn';
  if (view.context === 'review') return '`/roborev` · `/list-projects` · `/agents` · `/capabilities`';
  return '`/list-projects` · `/add-project` · `/agents` · `/usage` · `/capabilities`';
}

function workMoves(view: HelpView): string {
  if (view.context === 'review') {
    return 'Review delivery is separate from task execution. Findings posted here do not mutate a task or provider session; implementation continues through the project channel and its durable task threads.';
  }
  return 'Project messages create durable task threads. Replies continue the same task. Provider changes inside a task create a confirmed sibling handoff rather than mutating the active session.';
}

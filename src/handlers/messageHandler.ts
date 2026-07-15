import type { GuildMember, Message } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { Project } from '../types.js';
import {
  getProjectByChannel,
  updateProjectModel,
  updateProjectProvider,
} from '../services/projectStore.js';
import {
  parseLoopCommand,
  startLoop,
  stopLoop,
  getLoopStatus,
  getLoopChannelForThread,
} from '../services/loopRunner.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactSensitiveText } from '../utils/redaction.js';

export interface MessageHandlerDependencies {
  coordinator: Pick<TaskCoordinator, 'startFromMessage' | 'continueFromMessage'>;
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectModel(name: string, model: string, provider?: AgentProviderId): void;
  updateProjectProvider(name: string, provider: AgentProviderId): void;
  isAuthorized(member: GuildMember | null | undefined): boolean;
  defaultClaudeModel: string;
  startLoop: typeof startLoop;
  stopLoop: typeof stopLoop;
  getLoopStatus: typeof getLoopStatus;
  getLoopChannelForThread: typeof getLoopChannelForThread;
}

function defaultDependencies(): MessageHandlerDependencies {
  return {
    coordinator: getTaskCoordinator(),
    getProjectByChannel,
    updateProjectModel,
    updateProjectProvider,
    isAuthorized,
    defaultClaudeModel: process.env.CLAUDE_MODEL ?? '',
    startLoop,
    stopLoop,
    getLoopStatus,
    getLoopChannelForThread,
  };
}

/** Parse a one-shot `/model <model-name> <prompt>` prefix. */
export function parseModelPrefix(text: string): { model: string | undefined; rest: string } {
  const match = text.match(/^\/model\s+(\S+)\s+([\s\S]+)$/i);
  return match
    ? { model: match[1], rest: match[2].trim() }
    : { model: undefined, rest: text };
}

function logPickup(message: Message, prompt: string, lagMs: number): void {
  const flag = lagMs > 2000 ? ' ⚠️ SLOW PICKUP' : '';
  console.log(`[msg] "${redactSensitiveText(prompt).slice(0, 50)}" from ${message.author.tag} | gateway lag ${lagMs}ms${flag}`);
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}

export async function handleMessage(
  message: Message,
  injected?: MessageHandlerDependencies,
): Promise<void> {
  if (message.author.bot || !message.guild) return;
  const prompt = message.content.trim();
  if (!prompt) return;

  const dependencies = injected ?? defaultDependencies();
  const lagMs = Date.now() - message.createdTimestamp;

  if (message.channel.isThread()) {
    const parentId = message.channel.parentId;
    if (!parentId) return;
    const project = dependencies.getProjectByChannel(parentId);
    if (!project || parentId !== project.agentChannelId) return;

    logPickup(message, prompt, lagMs);
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!dependencies.isAuthorized(member)) return;

    const lower = prompt.toLowerCase();
    if (lower.startsWith('/stop-loop') || lower.startsWith('/stoploop') || lower.startsWith('/stop loop')) {
      const loopChannelId = dependencies.getLoopChannelForThread(message.channel.id);
      if (loopChannelId) await dependencies.stopLoop(loopChannelId, message);
      else await message.reply('No loop is associated with this thread.');
      return;
    }

    if (lower === '/status') {
      const loopChannelId = dependencies.getLoopChannelForThread(message.channel.id);
      const status = loopChannelId ? dependencies.getLoopStatus(loopChannelId) : null;
      if (status) await message.reply(status);
      else await message.reply('No loop is associated with this thread.');
      return;
    }

    if (lower.startsWith('/provider')) {
      await message.reply('A task thread keeps the provider it started with. Change the project default in the main project channel.');
      return;
    }

    if (/^\/model(\s+\S+)?$/i.test(prompt)) {
      await message.reply(
        'Usage in threads: `/model <name> <prompt>` for a one-shot model override. ' +
        'Change the project default with `/model <name>` in the main project channel.',
      );
      return;
    }

    const parsed = parseModelPrefix(prompt);
    try {
      await dependencies.coordinator.continueFromMessage({
        prompt: parsed.rest,
        message,
        ...(parsed.model ? { model: parsed.model } : {}),
      });
    } catch (error) {
      await message.reply(`Unable to continue this task: ${errorMessage(error)}`);
    }
    return;
  }

  const project = dependencies.getProjectByChannel(message.channelId);
  if (!project || message.channelId !== project.agentChannelId) return;

  logPickup(message, prompt, lagMs);
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!dependencies.isAuthorized(member)) {
    await message.reply('You are not authorized to use this bot.');
    return;
  }

  const { model: oneShotModel, rest: actualPrompt } = parseModelPrefix(prompt);
  if (!oneShotModel && prompt.startsWith('/')) {
    const handled = await handleBotCommand(prompt, project, message, dependencies);
    if (handled) return;
  }

  const resolvedModel = oneShotModel
    ?? project.models?.[project.defaultProvider]
    ?? (project.defaultProvider === 'claude' ? dependencies.defaultClaudeModel : undefined);

  try {
    await dependencies.coordinator.startFromMessage({
      projectName: project.name,
      prompt: actualPrompt,
      message,
      provider: project.defaultProvider,
      ...(resolvedModel ? { model: resolvedModel } : {}),
    });
  } catch (error) {
    await message.reply(`Unable to start this task: ${errorMessage(error)}`);
  }
}

async function handleBotCommand(
  content: string,
  project: Project,
  message: Message,
  dependencies: MessageHandlerDependencies,
): Promise<boolean> {
  const lower = content.toLowerCase();

  if (lower === '/provider' || /^\/provider\s+\S+$/i.test(content)) {
    const requested = content.split(/\s+/)[1]?.toLowerCase() as AgentProviderId | undefined;
    if (!requested) {
      await message.reply(`Default provider for **${project.name}**: \`${project.defaultProvider}\`.`);
      return true;
    }
    if (requested === 'codex') {
      await message.reply('Codex App Server support arrives in Phase 2. The project provider was not changed.');
      return true;
    }
    if (requested !== 'claude') {
      await message.reply('Provider must be `claude` or `codex`.');
      return true;
    }
    dependencies.updateProjectProvider(project.name, 'claude');
    await message.reply(`Default provider for **${project.name}** set to **Claude**.`);
    return true;
  }

  if (lower === '/model' || /^\/model\s+\S+$/i.test(content)) {
    const arg = content.split(/\s+/)[1];
    const provider = project.defaultProvider;
    if (!arg) {
      const current = project.models?.[provider]
        || (provider === 'claude' ? dependencies.defaultClaudeModel : '')
        || 'provider default';
      await message.reply(
        `Current ${provider} model for **${project.name}**: \`${current}\`.\n` +
        'Set it with `/model <name>`, or prefix a prompt with `/model <name>` for a one-shot override.',
      );
      return true;
    }
    dependencies.updateProjectModel(project.name, arg, provider);
    await message.reply(`${provider} model for **${project.name}** set to \`${arg}\`.`);
    return true;
  }

  if (lower.startsWith('/loop')) {
    const parsed = parseLoopCommand(content);
    if (!parsed) {
      await message.reply(
        '**Usage:** `/loop [interval] <prompt>`\n' +
        'Examples:\n- `/loop 5m check for failing tests`\n- `/loop 1h summarize git log`\n' +
        '- `/loop review open PRs` (defaults to 10m)',
      );
      return true;
    }
    await dependencies.startLoop(parsed.intervalMs, parsed.prompt, project, message);
    return true;
  }

  if (lower.startsWith('/stop-loop') || lower.startsWith('/stoploop') || lower.startsWith('/stop loop')) {
    await dependencies.stopLoop(project.agentChannelId, message);
    return true;
  }

  if (lower === '/status') {
    const status = dependencies.getLoopStatus(project.agentChannelId);
    await message.reply(status ?? 'No loop running. Send a message to start an agent task, or use `/loop` for recurring work.');
    return true;
  }

  return false;
}

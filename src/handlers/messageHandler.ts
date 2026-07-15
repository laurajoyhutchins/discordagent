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
import { getPrimaryAgentService } from '../services/primaryAgentServiceRegistry.js';
import { getProviderRegistry, maybeGetPendingTaskService } from '../services/agentRuntimeService.js';
import { UsageAdmissionError } from '../services/usageAdmission.js';

export interface MessageHandlerDependencies {
  coordinator: Pick<TaskCoordinator, 'startFromMessage' | 'continueFromMessage' | 'estimateHandoff' | 'handoffFromThread'>;
  getProjectByChannel(channelId: string): Project | undefined;
  updateProjectModel(name: string, model: string, provider?: AgentProviderId): void;
  updateProjectProvider(name: string, provider: AgentProviderId): void;
  checkProvider?(provider: AgentProviderId): Promise<{ available: boolean; reason?: string; authenticationRequired?: boolean }>;
  deferPendingTask?(input: { userId: string; projectName: string; prompt: string; message: Message; model?: string }): void;
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
    checkProvider: provider => getProviderRegistry().require(provider).checkAvailability(),
    deferPendingTask: input => { maybeGetPendingTaskService()?.defer(input); },
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
  if (error instanceof UsageAdmissionError) {
    return redactSensitiveText(`${error.message} ${error.recommendation}`);
  }
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}


export async function handleMessage(
  message: Message,
  injected?: MessageHandlerDependencies,
): Promise<void> {
  if (message.author.bot || !message.guild) return;
  const prompt = message.content.trim();
  if (!prompt) return;

  const primary = getPrimaryAgentService();
  if (!injected && primary && message.channelId === primary.channelId) { await primary.handleMessage(message); return; }

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
      const target = lower.split(/\s+/)[1] as AgentProviderId | undefined;
      if (target !== 'claude' && target !== 'codex') {
        await message.reply('Use `/provider claude` or `/provider codex`. A confirmed handoff creates a sibling thread.');
        return;
      }
      try {
        const estimate = await dependencies.coordinator.estimateHandoff(message.channel.id, target);
        const confirmation = await message.reply({
          content: `Switching providers creates a fresh **${target}** session in a sibling thread. Estimated handoff context: ~${estimate.estimatedInputTokens.toLocaleString()} input tokens (${estimate.confidence} confidence). This excludes future tool output.`,
          components: [{ type: 1, components: [
            { type: 2, custom_id: `handoff_confirm:${target}`, label: 'Create sibling task', style: 3 },
            { type: 2, custom_id: 'handoff_cancel', label: 'Cancel', style: 2 },
          ] }],
        });
        const decision = await confirmation.awaitMessageComponent({ time: 60_000, filter: candidate => candidate.user.id === message.author.id });
        if (decision.customId === 'handoff_cancel') {
          await decision.update({ content: 'Provider handoff cancelled. The original task is unchanged.', components: [] });
          return;
        }
        await decision.update({ content: `Creating the ${target} sibling task…`, components: [] });
        await dependencies.coordinator.handoffFromThread({ sourceThread: message.channel, targetProvider: target });
      } catch (error) {
        await message.reply(`Unable to hand off this task: ${errorMessage(error)}`);
      }
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

  if (project.defaultProvider === 'codex' && dependencies.checkProvider) {
    const availability = await dependencies.checkProvider('codex');
    if (!availability.available && availability.authenticationRequired) {
      dependencies.deferPendingTask?.({
        userId: message.author.id,
        projectName: project.name,
        prompt: actualPrompt,
        message,
        ...(resolvedModel ? { model: resolvedModel } : {}),
      });
      await message.reply('🔐 Codex sign-in is required. Your task has been held for 30 minutes without creating a thread or worktree. Run `/codex-auth login`; after verification you can explicitly **Start task** or discard it.');
      return;
    }
  }

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
    if (requested !== 'claude' && requested !== 'codex') {
      await message.reply('Provider must be `claude` or `codex`.');
      return true;
    }
    const availability = dependencies.checkProvider
      ? await dependencies.checkProvider(requested)
      : { available: requested === 'claude', reason: requested === 'codex' ? 'Codex is unavailable in this runtime.' : undefined };
    if (!availability.available) {
      await message.reply(availability.reason ?? `${requested} is unavailable on this host.`);
      return true;
    }
    dependencies.updateProjectProvider(project.name, requested);
    await message.reply(`Default provider for **${project.name}** set to **${requested === 'codex' ? 'Codex' : 'Claude'}**.`);
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

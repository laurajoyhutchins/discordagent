import { randomUUID } from 'node:crypto';
import type { Message, TextChannel } from 'discord.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { PrimaryModel, PrimaryResponse, PrimaryTaskProposal } from './primaryModel.js';
import type { ContextAssembler } from './contextAssembler.js';
import { redactSensitiveText, redactSensitiveValue } from '../utils/redaction.js';
import { UsageAdmissionError } from '../services/usageAdmission.js';
import { buildErrorEmbed, isStructuredErrorMessage } from '../discord/errorCard.js';

export interface PrimaryAgentService {
  readonly channelId: string;
  readonly ownerId: string;
  handleMessage(message: Message): Promise<void>;
}
export function createPrimaryAgentService(deps: {
  channelId: string; ownerId: string; model: PrimaryModel; context: ContextAssembler;
  messages: MessageRepository; memories: MemoryRepository; projects: ProjectRepository; coordinator: TaskCoordinator;
  fetchProjectChannel(channelId: string): Promise<TextChannel | null>;
}): PrimaryAgentService {
  function sanitizeResponse(response: PrimaryResponse): PrimaryResponse {
    return {
      ...response,
      reply: redactSensitiveText(response.reply),
      ...(response.taskProposal ? {
        taskProposal: {
          ...response.taskProposal,
          projectName: redactSensitiveText(response.taskProposal.projectName),
          objective: redactSensitiveText(response.taskProposal.objective),
          ...(response.taskProposal.rationale ? { rationale: redactSensitiveText(response.taskProposal.rationale) } : {}),
        },
      } : {}),
      ...(response.memoryWrites ? {
        memoryWrites: response.memoryWrites.map(write => ({
          ...write,
          namespace: redactSensitiveText(write.namespace),
          key: redactSensitiveText(write.key),
          value: redactSensitiveValue(write.value),
          sourceQuote: redactSensitiveText(write.sourceQuote),
        })),
      } : {}),
      ...(response.decision ? {
        decision: {
          ...response.decision,
          prompt: redactSensitiveText(response.decision.prompt),
          options: response.decision.options.map(redactSensitiveText),
        },
      } : {}),
    };
  }
  async function launch(proposal: PrimaryTaskProposal): Promise<void> {
    const project = deps.projects.findByName(proposal.projectName);
    if (!project) throw new Error(`Project "${proposal.projectName}" is not registered`);
    const channel = await deps.fetchProjectChannel(project.agentChannelId);
    if (!channel) throw new Error(`Project channel for "${proposal.projectName}" is unavailable`);
    const seed = await channel.send(`Delegated by the primary agent: ${proposal.objective}`);
    await deps.coordinator.startFromMessage({ projectName: project.name, prompt: proposal.objective, message: seed, provider: proposal.provider ?? project.defaultProvider });
  }
  async function launchWithFeedback(message: Message, proposal: PrimaryTaskProposal): Promise<boolean> {
    try {
      await launch(proposal);
      return true;
    } catch (error) {
      if (error instanceof UsageAdmissionError) {
        await message.reply(`${error.message}

${error.recommendation}`);
        return false;
      }
      throw error;
    }
  }
  return {
    channelId: deps.channelId,
    ownerId: deps.ownerId,
    async handleMessage(message) {
      if (message.author.bot || message.author.id !== deps.ownerId || message.channelId !== deps.channelId) return;
      deps.messages.append({ id: message.id, channelId: message.channelId, authorId: message.author.id, role: 'user', content: redactSensitiveText(message.content), createdAt: message.createdTimestamp });
      const context = deps.context.assemble({ channelId: message.channelId, query: message.content });
      const response = sanitizeResponse(await deps.model.respond({ context, message: message.content }));
      const replyText = redactSensitiveText(response.reply);
      const replyPayload = isStructuredErrorMessage(replyText)
        ? { embeds: [buildErrorEmbed(replyText, 'Coordination error')] }
        : replyText;
      deps.messages.append({ id: randomUUID(), channelId: message.channelId, authorId: 'primary-agent', role: 'assistant', content: replyText, createdAt: Date.now() });
      const allowedMemoryNamespaces = new Set(['user', 'goals', 'projects', 'decisions']);
      for (const write of response.memoryWrites ?? []) {
        const quote = write.sourceQuote?.trim();
        if (!quote || !message.content.toLowerCase().includes(quote.toLowerCase())) continue;
        if (!allowedMemoryNamespaces.has(write.namespace)) continue;
        deps.memories.put({ namespace: write.namespace, key: write.key, value: redactSensitiveValue(write.value), sourceType: 'direct_user', sourceId: message.id, confidence: write.confidence ?? 0.9, readOnly: false });
      }
      if (typeof replyPayload !== 'string') {
        await message.reply(replyPayload);
        return;
      }
      const explicit = /\b(go ahead|do it|start|proceed|implement|take care of it)\b/i.test(message.content);
      if (response.taskProposal && explicit && !response.decision) {
        await message.reply(`${replyText}\n\nStarting the delegated task in **${response.taskProposal.projectName}**.`);
        await launchWithFeedback(message, response.taskProposal);
        return;
      }
      if (response.taskProposal) {
        const proposal = response.taskProposal;
        const sent = await message.reply({ content: `${replyText}\n\n**Proposed task** — ${proposal.projectName}: ${proposal.objective}`, components: [{ type: 1, components: [
          { type: 2, custom_id: 'primary_task_start', label: 'Start task', style: 3 },
          { type: 2, custom_id: 'primary_task_cancel', label: 'Cancel', style: 2 },
        ] }] });
        try {
          const decision = await sent.awaitMessageComponent({ time: 120_000, filter: i => i.user.id === deps.ownerId });
          if (decision.customId === 'primary_task_start') {
            await decision.update({ content: 'Starting the delegated task…', components: [] });
            await launchWithFeedback(message, proposal);
          } else await decision.update({ content: 'Task proposal cancelled.', components: [] });
        } catch { await sent.edit({ components: [] }).catch(() => undefined); }
        return;
      }
      if (response.decision?.kind === 'poll' && response.decision.options.length >= 2) {
        await (message.channel as TextChannel).send({ content: replyText, poll: { question: { text: response.decision.prompt.slice(0, 300) }, answers: response.decision.options.slice(0, 10).map(text => ({ text: text.slice(0, 55) })), duration: 24, allowMultiselect: false } } as never);
        return;
      }
      if (response.decision?.kind === 'confirm' || response.decision?.kind === 'select') {
        const options = response.decision.options.length >= 2
          ? response.decision.options.slice(0, response.decision.kind === 'select' ? 25 : 2)
          : ['Proceed', 'Cancel'];
        const components = response.decision.kind === 'confirm'
          ? [{ type: 1, components: options.map((label, index) => ({ type: 2, custom_id: `primary_decision:${index}`, label: label.slice(0, 80), style: index === 0 ? 3 : 2 })) }]
          : [{ type: 1, components: [{ type: 3, custom_id: 'primary_decision_select', placeholder: 'Choose an option', options: options.map((label, index) => ({ label: label.slice(0, 100), value: String(index) })) }] }];
        const sent = await message.reply({ content: `${replyText}

**Decision:** ${response.decision.prompt}`, components } as never);
        try {
          const interaction = await sent.awaitMessageComponent({ time: 120_000, filter: candidate => candidate.user.id === deps.ownerId });
          const index = interaction.isStringSelectMenu?.()
            ? Number(interaction.values[0])
            : Number(interaction.customId.split(':')[1]);
          const selected = options[Number.isInteger(index) && index >= 0 && index < options.length ? index : 0];
          await interaction.update({ content: `Decision recorded: **${selected}**`, components: [] });
          const decisionText = `Decision: ${response.decision.prompt} — ${selected}`;
          deps.messages.append({ id: interaction.id ?? randomUUID(), channelId: message.channelId, authorId: deps.ownerId, role: 'user', content: decisionText, createdAt: Date.now() });
          const followUp = await deps.model.respond({ context: deps.context.assemble({ channelId: message.channelId, query: decisionText }), message: decisionText });
          const followText = redactSensitiveText(followUp.reply);
          deps.messages.append({ id: randomUUID(), channelId: message.channelId, authorId: 'primary-agent', role: 'assistant', content: followText, createdAt: Date.now() });
          await message.reply(followText);
        } catch {
          await sent.edit({ components: [] }).catch(() => undefined);
        }
        return;
      }
      await message.reply(replyPayload);
    },
  };
}

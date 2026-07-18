import { randomUUID } from 'node:crypto';
import type { Message, TextChannel } from 'discord.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { PrimaryModel, PrimaryTaskProposal } from './primaryModel.js';
import type { ContextAssembler } from './contextAssembler.js';
import { createPrimaryConversationService, type PrimaryConversationService } from './primaryConversationService.js';
import { redactSensitiveText } from '../utils/redaction.js';
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
  conversationService?: PrimaryConversationService;
}): PrimaryAgentService {
  const conversation: PrimaryConversationService = deps.conversationService ?? createPrimaryConversationService({
    context: deps.context,
    messages: deps.messages,
    memories: deps.memories,
    projects: deps.projects,
    coordinator: deps.coordinator,
    model: deps.model,
    launchTask: async (proposal: PrimaryTaskProposal) => {
      await launchWithFeedback(proposal);
    },
  });

  async function launch(proposal: PrimaryTaskProposal): Promise<void> {
    const project = deps.projects.findByName(proposal.projectName);
    if (!project) throw new Error(`Project "${proposal.projectName}" is not registered`);
    const channel = await deps.fetchProjectChannel(project.agentChannelId);
    if (!channel) throw new Error(`Project channel for "${proposal.projectName}" is unavailable`);
    const seed = await channel.send(`Delegated by the primary agent: ${proposal.objective}`);
    await deps.coordinator.startFromMessage({ projectName: project.name, prompt: proposal.objective, message: seed, provider: proposal.provider ?? project.defaultProvider });
  }

  async function launchWithFeedback(proposal: PrimaryTaskProposal): Promise<boolean> {
    try {
      await launch(proposal);
      return true;
    } catch (error) {
      if (error instanceof UsageAdmissionError) {
        // Re-throw for the caller to handle with Discord-specific rendering
        throw error;
      }
      throw error;
    }
  }

  function renderReply(replyText: string): string | { embeds: ReturnType<typeof buildErrorEmbed>[] } {
    return isStructuredErrorMessage(replyText)
      ? { embeds: [buildErrorEmbed(replyText, 'Coordination error')] }
      : replyText;
  }

  return {
    channelId: deps.channelId,
    ownerId: deps.ownerId,
    async handleMessage(message) {
      if (message.author.bot || message.author.id !== deps.ownerId || message.channelId !== deps.channelId) return;

      const result = await conversation.process({
        conversationId: message.channelId,
        userId: message.author.id,
        text: message.content,
        createdAt: message.createdTimestamp,
      });

      if (result.kind === 'reply') {
        await message.reply(renderReply(result.text));
        return;
      }

      if (result.kind === 'usage-rejected') {
        await message.reply(`${result.text}\n\n${result.recommendation}`);
        return;
      }

      if (result.kind === 'task-proposal') {
        const proposal = result.proposal;
        const replyText = result.text;

        if (result.explicit) {
          await message.reply(`${replyText}\n\nStarting the delegated task in **${proposal.projectName}**.`);
          try {
            await launch(proposal);
          } catch (error) {
            if (error instanceof UsageAdmissionError) {
              await message.reply(`${error.message}\n\n${error.recommendation}`);
            } else {
              throw error;
            }
          }
          return;
        }

        const sent = await message.reply({
          content: `${replyText}\n\n**Proposed task** — ${proposal.projectName}: ${proposal.objective}`,
          components: [{
            type: 1, components: [
              { type: 2, custom_id: 'primary_task_start', label: 'Start task', style: 3 },
              { type: 2, custom_id: 'primary_task_cancel', label: 'Cancel', style: 2 },
            ],
          }],
        });
        try {
          const decision = await sent.awaitMessageComponent({
            time: 120_000,
            filter: i => i.user.id === deps.ownerId,
          });
          if (decision.customId === 'primary_task_start') {
            await decision.update({ content: 'Starting the delegated task…', components: [] });
            try {
              await launch(proposal);
            } catch (error) {
              if (error instanceof UsageAdmissionError) {
                await message.reply(`${error.message}\n\n${error.recommendation}`);
              } else {
                throw error;
              }
            }
          } else {
            await decision.update({ content: 'Task proposal cancelled.', components: [] });
          }
        } catch {
          await sent.edit({ components: [] }).catch(() => undefined);
        }
        return;
      }

      if (result.kind === 'decision') {
        const replyText = result.text;
        const decision = result.decision;

        if (decision.kind === 'poll' && decision.options.length >= 2) {
          await (message.channel as TextChannel).send({
            content: replyText,
            poll: {
              question: { text: decision.prompt.slice(0, 300) },
              answers: decision.options.slice(0, 10).map(text => ({ text: text.slice(0, 55) })),
              duration: 24,
              allowMultiselect: false,
            },
          } as never);
          return;
        }

        const options = decision.options.length >= 2
          ? decision.options.slice(0, decision.kind === 'select' ? 25 : 2)
          : ['Proceed', 'Cancel'];
        const components = decision.kind === 'confirm'
          ? [{
              type: 1, components: options.map((label, index) => ({
                type: 2, custom_id: `primary_decision:${index}`, label: label.slice(0, 80),
                style: index === 0 ? 3 : 2,
              })),
            }]
          : [{
              type: 1, components: [{
                type: 3, custom_id: 'primary_decision_select',
                placeholder: 'Choose an option',
                options: options.map((label, index) => ({
                  label: label.slice(0, 100), value: String(index),
                })),
              }],
            }];
        const sent = await message.reply({
          content: `${replyText}\n\n**Decision:** ${decision.prompt}`,
          components,
        } as never);
        try {
          const interaction = await sent.awaitMessageComponent({
            time: 120_000,
            filter: candidate => candidate.user.id === deps.ownerId,
          });
          const index = interaction.isStringSelectMenu?.()
            ? Number(interaction.values[0])
            : Number(interaction.customId.split(':')[1]);
          const selected = options[Number.isInteger(index) && index >= 0 && index < options.length ? index : 0];
          await interaction.update({ content: `Decision recorded: **${selected}**`, components: [] });

          const followResult = await conversation.resolveDecision({
            conversationId: message.channelId,
            userId: deps.ownerId,
            decisionPrompt: decision.prompt,
            selectedOption: selected,
          });

          if (followResult.kind === 'reply') {
            await message.reply(renderReply(followResult.text));
          } else if (followResult.kind === 'task-proposal') {
            const fp = followResult.proposal;
            const reusableSent = await message.reply({
              content: `${followResult.text}\n\n**Proposed task** — ${fp.projectName}: ${fp.objective}`,
              components: [{
                type: 1, components: [
                  { type: 2, custom_id: 'primary_task_start', label: 'Start task', style: 3 },
                  { type: 2, custom_id: 'primary_task_cancel', label: 'Cancel', style: 2 },
                ],
              }],
            });
            try {
              const followDecision = await reusableSent.awaitMessageComponent({
                time: 120_000, filter: i => i.user.id === deps.ownerId,
              });
              if (followDecision.customId === 'primary_task_start') {
                await followDecision.update({ content: 'Starting the delegated task…', components: [] });
                try {
                  await launch(fp);
                } catch (error) {
                  if (error instanceof UsageAdmissionError) {
                    await message.reply(`${error.message}\n\n${error.recommendation}`);
                  } else {
                    throw error;
                  }
                }
              } else {
                await followDecision.update({ content: 'Task proposal cancelled.', components: [] });
              }
            } catch {
              await reusableSent.edit({ components: [] }).catch(() => undefined);
            }
          }
        } catch {
          await sent.edit({ components: [] }).catch(() => undefined);
        }
        return;
      }
    },
  };
}

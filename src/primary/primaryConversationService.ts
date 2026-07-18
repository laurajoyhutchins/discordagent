import { randomUUID } from 'node:crypto';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { PrimaryModel, PrimaryResponse, PrimaryTaskProposal } from './primaryModel.js';
import type { ContextAssembler } from './contextAssembler.js';
import { redactSensitiveText, redactSensitiveValue } from '../utils/redaction.js';

export interface PrimaryConversationInput {
  conversationId: string;
  userId: string;
  text: string;
  createdAt?: number;
  currentProjectName?: string;
}

export type ProcessResult =
  | { kind: 'reply'; text: string }
  | { kind: 'task-proposal'; text: string; proposal: PrimaryTaskProposal; explicit: boolean }
  | { kind: 'decision'; text: string; decision: { kind: 'confirm' | 'select' | 'poll'; prompt: string; options: string[] } }
  | { kind: 'usage-rejected'; text: string; recommendation: string };

export interface DecisionResolutionInput {
  conversationId: string;
  userId: string;
  decisionPrompt: string;
  selectedOption: string;
  createdAt?: number;
  currentProjectName?: string;
}

export interface PrimaryConversationService {
  process(input: PrimaryConversationInput): Promise<ProcessResult>;
  resolveDecision(input: DecisionResolutionInput): Promise<ProcessResult>;
  launchTask(proposal: PrimaryTaskProposal): Promise<void>;
}

/**
 * A delegating wrapper whose inner service can be swapped at runtime.
 * The REPL and Discord adapter both hold a reference to the same delegator,
 * so provider/model reconfiguration updates both transparently.
 */
export function createDelegatingConversationService(): {
  service: PrimaryConversationService;
  setTarget(target: PrimaryConversationService): void;
} {
  let target: PrimaryConversationService = {
    process: () => Promise.reject(new Error('Conversation service not yet initialized')),
    resolveDecision: () => Promise.reject(new Error('Conversation service not yet initialized')),
    launchTask: () => Promise.reject(new Error('Conversation service not yet initialized')),
  };
  return {
    service: {
      process(input) { return target.process(input); },
      resolveDecision(input) { return target.resolveDecision(input); },
      launchTask(proposal) { return target.launchTask(proposal); },
    },
    setTarget(newTarget) { target = newTarget; },
  };
}

export function createPrimaryConversationService(deps: {
  context: ContextAssembler;
  messages: MessageRepository;
  memories: MemoryRepository;
  projects: ProjectRepository;
  coordinator: TaskCoordinator;
  model: PrimaryModel;
  launchTask?: (proposal: PrimaryTaskProposal) => Promise<void>;
}): PrimaryConversationService {
  const allowedMemoryNamespaces = new Set(['user', 'goals', 'projects', 'decisions']);

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

  function persistMemory(response: PrimaryResponse, sourceText: string, sourceId: string): void {
    for (const write of response.memoryWrites ?? []) {
      const quote = write.sourceQuote?.trim();
      if (!quote || !sourceText.toLowerCase().includes(quote.toLowerCase())) continue;
      if (!allowedMemoryNamespaces.has(write.namespace)) continue;
      deps.memories.put({
        namespace: write.namespace,
        key: write.key,
        value: redactSensitiveValue(write.value),
        sourceType: 'direct_user',
        sourceId,
        confidence: write.confidence ?? 0.9,
        readOnly: false,
      });
    }
  }

  async function runModel(conversationId: string, query: string, currentProjectName?: string): Promise<PrimaryResponse> {
    const context = deps.context.assemble({ channelId: conversationId, query, currentProjectName });
    return sanitizeResponse(await deps.model.respond({ context, message: query }));
  }

  return {
    async process(input): Promise<ProcessResult> {
      const messageId = randomUUID();

      deps.messages.append({
        id: messageId,
        channelId: input.conversationId,
        authorId: input.userId,
        role: 'user',
        content: redactSensitiveText(input.text),
        createdAt: input.createdAt ?? Date.now(),
      });

      const response = await runModel(input.conversationId, input.text, input.currentProjectName);
      const replyText = response.reply;

      deps.messages.append({
        id: randomUUID(),
        channelId: input.conversationId,
        authorId: 'primary-agent',
        role: 'assistant',
        content: replyText,
        createdAt: Date.now(),
      });

      persistMemory(response, input.text, messageId);

      const explicit = /\b(go ahead|do it|start|proceed|implement|take care of it)\b/i.test(input.text);

      if (response.taskProposal && !response.decision) {
        return {
          kind: 'task-proposal',
          text: replyText,
          proposal: response.taskProposal,
          explicit,
        };
      }

      if (response.decision) {
        return {
          kind: 'decision',
          text: replyText,
          decision: response.decision,
        };
      }

      return { kind: 'reply', text: replyText };
    },

    async resolveDecision(input): Promise<ProcessResult> {
      const decisionText = `Decision: ${input.decisionPrompt} — ${input.selectedOption}`;
      const decisionMessageId = randomUUID();

      deps.messages.append({
        id: decisionMessageId,
        channelId: input.conversationId,
        authorId: input.userId,
        role: 'user',
        content: decisionText,
        createdAt: input.createdAt ?? Date.now(),
      });

      const response = await runModel(input.conversationId, decisionText, input.currentProjectName);
      const replyText = response.reply;

      deps.messages.append({
        id: randomUUID(),
        channelId: input.conversationId,
        authorId: 'primary-agent',
        role: 'assistant',
        content: replyText,
        createdAt: Date.now(),
      });

      persistMemory(response, decisionText, decisionMessageId);

      if (response.taskProposal && !response.decision) {
        return {
          kind: 'task-proposal',
          text: replyText,
          proposal: response.taskProposal,
          explicit: false,
        };
      }

      if (response.decision) {
        return {
          kind: 'decision',
          text: replyText,
          decision: response.decision,
        };
      }

      return { kind: 'reply', text: replyText };
    },

    async launchTask(proposal: PrimaryTaskProposal): Promise<void> {
      if (!deps.launchTask) throw new Error('Task launching is not available in this adapter');
      await deps.launchTask(proposal);
    },
  };
}

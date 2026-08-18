import type { AnyThreadChannel } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import { createChatgptSessionRepository } from '../repositories/chatgptSessionRepository.js';
import { terminalizeLoopByThread } from '../services/loopRunner.js';
import { getProjectDatabase } from '../services/projectStore.js';
import { getTaskCoordinator } from '../services/taskCoordinatorService.js';
import { redactErrorMessage } from '../utils/redaction.js';

type LoopTerminalizer = (
  threadId: string,
  reason: string,
) => unknown;

type ChatgptSessionRetirer = (threadId: string) => unknown;

function retireChatgptSessionByThread(threadId: string): unknown {
  return createChatgptSessionRepository(getProjectDatabase()).retireByThreadId(threadId);
}

export async function handleThreadDelete(
  thread: AnyThreadChannel,
  coordinator: Pick<TaskCoordinator, 'cancelByThread'> = getTaskCoordinator(),
  terminalizeLoop: LoopTerminalizer = terminalizeLoopByThread,
  retireChatgptSession: ChatgptSessionRetirer = retireChatgptSessionByThread,
): Promise<void> {
  let loopTerminalized = false;
  try {
    loopTerminalized = Boolean(terminalizeLoop(thread.id, 'Discord loop thread deleted'));
  } catch (error) {
    console.error(
      `[thread] Failed to terminalize loop for deleted thread ${thread.id}:`,
      redactErrorMessage(error),
    );
  }

  let chatgptSessionRetired = false;
  try {
    chatgptSessionRetired = Boolean(retireChatgptSession(thread.id));
  } catch (error) {
    console.error(
      `[thread] Failed to retire ChatGPT session binding for deleted thread ${thread.id}:`,
      redactErrorMessage(error),
    );
  }

  let taskCancelled = false;
  try {
    taskCancelled = await coordinator.cancelByThread(thread.id);
  } catch (error) {
    console.error(
      `[thread] Failed to cancel durable task for deleted thread ${thread.id}:`,
      redactErrorMessage(error),
    );
  }

  console.log(
    `[thread] Deleted thread ${thread.id}; `
    + `${taskCancelled ? 'durable task cancelled and worktree preserved' : 'no active durable task found'}; `
    + `${loopTerminalized ? 'scheduled loop terminalized' : 'no active scheduled loop found'}; `
    + `${chatgptSessionRetired ? 'ChatGPT session binding retired' : 'no active ChatGPT session binding found'}`,
  );
}

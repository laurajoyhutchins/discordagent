import type { CapabilityEvaluationContext, CapabilityPermissionChannel } from '../discord/capabilities/evaluator.js';
import { assertCapabilities, evaluateCapabilities } from '../discord/capabilities/evaluator.js';

export const TASK_CREATION_CAPABILITIES = [
  'core.guild.access',
  'core.channel.view',
  'core.message.send',
  'core.message.history',
  'task.thread.create.public',
  'task.thread.send',
] as const;

export const TASK_THREAD_CAPABILITIES = [
  'core.guild.access',
  'core.channel.view',
  'core.message.send',
  'core.message.history',
  'task.thread.send',
] as const;

export interface TaskCapabilityPreflight {
  assertCanCreateTaskThread(channel: unknown): void;
  assertCanUseTaskThread?(channel: unknown): void;
}

export function createTaskCapabilityPreflight(
  createContext: (channel: CapabilityPermissionChannel) => CapabilityEvaluationContext,
): TaskCapabilityPreflight {
  return {
    assertCanCreateTaskThread(channel): void {
      const permissionChannel = channel as CapabilityPermissionChannel;
      assertCapabilities(
        evaluateCapabilities(TASK_CREATION_CAPABILITIES, createContext(permissionChannel)),
        'Cannot create the Discord task thread with the current capability state.',
      );
    },
    assertCanUseTaskThread(channel): void {
      const permissionChannel = channel as CapabilityPermissionChannel;
      assertCapabilities(
        evaluateCapabilities(TASK_THREAD_CAPABILITIES, createContext(permissionChannel)),
        'Cannot use the Discord task thread with the current capability state.',
      );
    },
  };
}

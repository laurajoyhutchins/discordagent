import type { AnyThreadChannel, Client } from 'discord.js';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import type { TaskRenderer } from '../discord/taskRenderer.js';
import type { EventRepository } from '../repositories/eventRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { UsageAdmissionService } from './usageAdmission.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface RuntimeRecoveryOptions {
  client: Client;
  coordinator: TaskCoordinator;
  events: EventRepository;
  tasks: TaskRepository;
  usage: UsageAdmissionService;
  rendererFactory: (thread: AnyThreadChannel) => TaskRenderer;
  headlessPrimaryAgent?: boolean;
}

export interface RuntimeRecoveryResult {
  stop(): Promise<void>;
}

export async function recoverRuntime(
  options: RuntimeRecoveryOptions,
): Promise<RuntimeRecoveryResult> {
  const recoveredTasks = await options.coordinator.recoverInterruptedTasks();
  const recoveredIds = new Set(recoveredTasks.map(task => task.id));
  for (const reservation of options.usage.reservations()) {
    const task = reservation.taskId ? options.tasks.findById(reservation.taskId) : undefined;
    if (
      !reservation.taskId
      || !task
      || recoveredIds.has(reservation.taskId)
      || ['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status)
    ) {
      try {
        options.usage.release(reservation.id);
      } catch {
        // Reservation was already finalized by a concurrent recovery path.
      }
    }
  }
  if (!options.headlessPrimaryAgent) {
    await notifyRecoveredTasks(
      options.client,
      recoveredTasks,
      options.events,
      options.tasks,
      options.rendererFactory,
    );
  }

  return { stop: async () => undefined };
}

async function notifyRecoveredTasks(
  client: Client,
  recoveredTasks: readonly import('../types.js').TaskRecord[],
  events: EventRepository,
  tasks: TaskRepository,
  rendererFactory: (thread: AnyThreadChannel) => TaskRenderer,
): Promise<void> {
  for (const task of recoveredTasks) {
    let channel: ({ send(payload: unknown): Promise<unknown> } & object) | null = null;
    let fetchError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        channel = await client.channels?.fetch(task.threadId) as typeof channel;
        fetchError = undefined;
        break;
      } catch (error) {
        fetchError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 25 * attempt));
      }
    }
    if (fetchError) {
      console.warn(
        `[runtime] Recovery checkpoint for task ${task.id} remains pending; Discord channel fetch failed:`,
        redactErrorMessage(fetchError),
      );
    }
    if (!channel) continue;

    const renderer = rendererFactory(channel as AnyThreadChannel);
    try {
      await Promise.resolve(renderer.start(channel as AnyThreadChannel, {
        task,
        ...(tasks.getWorktree(task.id) ? { worktree: tasks.getWorktree(task.id) } : {}),
        phase: 'Recovery checkpoint',
      })).catch((error: unknown) => {
        console.warn('[runtime] Failed to reconstruct task control card:', redactErrorMessage(error));
      });

      const storedEvents = events.list(task.id);
      let detail: string | undefined;
      for (let index = storedEvents.length - 1; index >= 0; index -= 1) {
        const event = storedEvents[index].event;
        if (event.type === 'status' && event.phase === 'Recovery checkpoint') {
          detail = event.detail;
          break;
        }
      }

      const content = [
        `⚠️ Task interrupted during bot restart: **${task.objective.slice(0, 160)}**`,
        detail ?? 'The task state was preserved. Resume requires explicit user action; no provider turn was replayed.',
        'Send a new message in this thread when you are ready to resume.',
      ].join('\n');

      await channel.send({ content }).catch((error: unknown) => {
        console.warn(
          `[runtime] Failed to post recovery checkpoint for task ${task.id}:`,
          redactErrorMessage(error),
        );
      });
    } finally {
      await Promise.resolve(renderer.dispose?.()).catch(error => {
        console.warn(
          `[runtime] Failed to dispose recovery renderer for task ${task.id}:`,
          redactErrorMessage(error),
        );
      });
    }
  }
}

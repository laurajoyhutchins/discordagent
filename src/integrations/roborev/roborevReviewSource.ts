import { type ChildProcess } from 'node:child_process';
import type { Project } from '../../types.js';
import { getAllProjects } from '../../services/projectStore.js';
import { config } from '../../config.js';
import type {
  ReviewSource,
  ReviewNotification,
  Disposable,
} from '../reviewSource.js';
import { spawnStream, fetchReviewBody, isCliAvailable } from './roborevCli.js';
import { matchProject, normalizeToNotification } from './roborevEventParser.js';
import { anyProjectHasRoborev } from './roborevRenderer.js';
import { onRoborevConfigurationChanged } from './roborevLifecycle.js';
import { redactErrorMessage, redactSensitiveText } from '../../utils/redaction.js';

const MAX_BACKOFF = 60_000;
const MAX_FAILURES = 10;
const INITIAL_BACKOFF = 1000;
const STABILITY_WINDOW = 5000;

export interface RoborevReviewSourceDependencies {
  cliPath: string;
  getProjects: () => Project[];
  fetchBody: (jobId: number) => Promise<string>;
}

export function createRoborevReviewSource(
  deps?: Partial<RoborevReviewSourceDependencies>,
): ReviewSource {
  const cliPath = deps?.cliPath ?? config.roborevCliPath;
  const getProjects = deps?.getProjects ?? getAllProjects;
  const fetchBody = deps?.fetchBody
    ?? ((jobId: number) => fetchReviewBody(cliPath, jobId));

  let childProcess: ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF;
  let consecutiveFailures = 0;
  let disposed = false;
  let started = false;
  let activePublish: ((notification: ReviewNotification) => Promise<void>) | null = null;
  let unsubscribeConfigurationChanges: (() => void) | null = null;

  function clearStabilityTimer(): void {
    if (!stabilityTimer) return;
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }

  function clearRestartTimer(): void {
    if (!restartTimer) return;
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  function stopActiveProcess(): void {
    clearRestartTimer();
    clearStabilityTimer();
    if (childProcess) {
      childProcess.removeAllListeners('close');
      childProcess.removeAllListeners('error');
      childProcess.kill('SIGTERM');
      childProcess = null;
    }
    backoffMs = INITIAL_BACKOFF;
    consecutiveFailures = 0;
  }

  function scheduleRestart(reason: string): void {
    if (disposed || restartTimer) return;

    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(
        `[roborev] Process failed ${consecutiveFailures} times. `
        + 'Change the RoboRev configuration or restart the bot to retry.',
      );
      return;
    }

    const delay = backoffMs;
    console.log(
      `[roborev] ${reason}. Restarting in ${delay}ms `
      + `(attempt ${consecutiveFailures}/${MAX_FAILURES})`,
    );
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);

    restartTimer = setTimeout(() => {
      restartTimer = null;
      void reconcile().catch(error => {
        console.error('[roborev] Retry failed:', redactErrorMessage(error));
      });
    }, delay);
  }

  async function doStart(): Promise<void> {
    if (disposed || !activePublish || childProcess || restartTimer) return;

    let process: ChildProcess;
    try {
      process = spawnStream(cliPath);
    } catch (error) {
      console.error('[roborev] Failed to spawn:', redactErrorMessage(error));
      scheduleRestart('Process failed to spawn');
      return;
    }

    childProcess = process;
    let settled = false;
    let lineBuffer = '';

    process.stdout!.on('data', async (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const rawEvent = JSON.parse(line) as { type: string; job_id: number; repo: string; repo_name: string; sha: string; agent: string; verdict?: string; ts: string };
          console.log(`[roborev] Event: ${rawEvent.type} job=${rawEvent.job_id} repo=${rawEvent.repo_name}`);

          const project = matchProject(rawEvent.repo, getProjects());
          if (!project?.roborevChannelId) continue;

          const notification = normalizeToNotification(
            rawEvent as Parameters<typeof normalizeToNotification>[0],
            project.name,
          );

          if (rawEvent.type === 'review.completed') {
            try {
              const body = await fetchBody(rawEvent.job_id);
              if (body) {
                notification.details = { ...notification.details, body };
              }
            } catch {
              // fetchBody failure is not fatal; publish proceeds without body.
            }
          }

          const publish = activePublish;
          if (!publish) continue;
          void publish(notification).catch(error => {
            console.error('[roborev] Failed to publish notification:', redactErrorMessage(error));
          });
        } catch {
          if (line.trim()) {
            console.error('[roborev] Non-JSON line:', redactSensitiveText(line));
          }
        }
      }
    });

    process.stderr!.on('data', (data: Buffer) => {
      console.error('[roborev stderr]', redactSensitiveText(data.toString()));
    });

    stabilityTimer = setTimeout(() => {
      stabilityTimer = null;
      if (childProcess === process && !settled) {
        backoffMs = INITIAL_BACKOFF;
        consecutiveFailures = 0;
      }
    }, STABILITY_WINDOW);

    const finish = (reason: string): void => {
      if (settled) return;
      settled = true;
      clearStabilityTimer();
      if (childProcess === process) childProcess = null;
      if (!disposed) scheduleRestart(reason);
    };

    process.on('close', code => {
      finish(`Process exited with code ${code}`);
    });

    process.on('error', error => {
      console.error('[roborev] Failed to spawn:', redactErrorMessage(error));
      finish('Process failed to spawn');
    });
  }

  async function reconcile(): Promise<void> {
    if (disposed || !activePublish) return;

    if (!anyProjectHasRoborev(getProjects())) {
      if (childProcess || restartTimer) {
        console.log('[roborev] No projects with roborev enabled, stopping watcher.');
        stopActiveProcess();
      }
      return;
    }

    if (childProcess || restartTimer) return;

    if (!(await isCliAvailable(cliPath))) {
      console.warn(`[roborev] CLI not found at "${cliPath}". Watcher disabled.`);
      return;
    }

    await doStart();
  }

  return {
    id: 'roborev',

    async start(
      publish: (notification: ReviewNotification) => Promise<void>,
    ): Promise<Disposable> {
      if (disposed) {
        throw new Error('Roborev review source was already disposed');
      }
      if (started) {
        throw new Error('Roborev review source was already started');
      }
      started = true;
      activePublish = publish;
      unsubscribeConfigurationChanges = onRoborevConfigurationChanged(() => {
        void reconcile().catch(error => {
          console.error('[roborev] Failed to reconcile configuration:', redactErrorMessage(error));
        });
      });

      await reconcile();

      return {
        async dispose() {
          if (disposed) return;
          disposed = true;
          activePublish = null;
          unsubscribeConfigurationChanges?.();
          unsubscribeConfigurationChanges = null;
          stopActiveProcess();
        },
      };
    },
  };
}

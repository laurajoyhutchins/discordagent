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
import { redactErrorMessage, redactSensitiveText } from '../../utils/redaction.js';

const MAX_BACKOFF = 60_000;
const MAX_FAILURES = 10;
const INITIAL_BACKOFF = 1000;

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

  async function doStart(): Promise<void> {
    if (disposed || !activePublish) return;

    if (childProcess) {
      childProcess.removeAllListeners('close');
      childProcess.removeAllListeners('error');
      childProcess.kill('SIGTERM');
      childProcess = null;
    }

    childProcess = spawnStream(cliPath);

    let lineBuffer = '';
    childProcess.stdout!.on('data', async (data: Buffer) => {
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

          void activePublish!(notification).catch(error => {
            console.error('[roborev] Failed to publish notification:', redactErrorMessage(error));
          });
        } catch {
          if (line.trim()) {
            console.error('[roborev] Non-JSON line:', redactSensitiveText(line));
          }
        }
      }
    });

    childProcess.stderr!.on('data', (data: Buffer) => {
      console.error('[roborev stderr]', redactSensitiveText(data.toString()));
    });

    stabilityTimer = setTimeout(() => {
      if (childProcess) {
        backoffMs = INITIAL_BACKOFF;
        consecutiveFailures = 0;
      }
    }, 5000);

    const currentStabilityTimer = stabilityTimer;
    stabilityTimer = null;
    clearTimeout(currentStabilityTimer!);
    childProcess.on('close', code => {
      childProcess = null;
      if (disposed) return;

      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) {
        console.error(
          `[roborev] Process failed ${consecutiveFailures} times. Restart the bot to retry.`,
        );
        return;
      }

      const delay = backoffMs;
      console.log(
        `[roborev] Process exited with code ${code}. Restarting in ${delay}ms `
        + `(attempt ${consecutiveFailures}/${MAX_FAILURES})`,
      );
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);

      restartTimer = setTimeout(() => {
        void doStart().catch(error => {
          console.error('[roborev] Retry failed:', redactErrorMessage(error));
        });
      }, delay);
    });

    childProcess.on('error', error => {
      clearTimeout(currentStabilityTimer!);
      stabilityTimer = null;
      if (disposed) return;
      console.error('[roborev] Failed to spawn:', redactErrorMessage(error));
      childProcess = null;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) {
        console.error(
          `[roborev] Spawn failed ${consecutiveFailures} times. Restart the bot to retry.`,
        );
        return;
      }
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      restartTimer = setTimeout(() => {
        void doStart().catch(retryError => {
          console.error('[roborev] Retry failed:', redactErrorMessage(retryError));
        });
      }, delay);
    });
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

      if (!anyProjectHasRoborev(getProjects())) {
        console.log('[roborev] No projects with roborev enabled, skipping watcher.');
        return {
          dispose: async () => {
            disposed = true;
          },
        };
      }

      if (!(await isCliAvailable(cliPath))) {
        console.warn(
          `[roborev] CLI not found at "${cliPath}". Watcher disabled.`,
        );
        return {
          dispose: async () => {
            disposed = true;
          },
        };
      }

      activePublish = publish;
      await doStart();

      return {
        async dispose() {
          disposed = true;
          if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
          }
          if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            stabilityTimer = null;
          }
          if (childProcess) {
            childProcess.removeAllListeners('close');
            childProcess.removeAllListeners('error');
            childProcess.kill('SIGTERM');
            childProcess = null;
          }
        },
      };
    },
  };
}

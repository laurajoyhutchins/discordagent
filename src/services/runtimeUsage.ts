import type { CodexAuthService, CodexRateLimitWindow } from '../agents/codex/codexAuthService.js';
import { redactErrorMessage } from '../utils/redaction.js';
import type { UsageAdmissionService } from './usageAdmission.js';

export interface UsageMonitoringOptions {
  usage: UsageAdmissionService;
  codexAuth?: CodexAuthService;
  disableUsagePolling?: boolean;
}

export interface UsageMonitoringResult {
  usagePoll?: ReturnType<typeof setInterval>;
  usageUnsubscribe?: () => void;
  stop(): Promise<void>;
}

export async function startUsageMonitoring(
  options: UsageMonitoringOptions,
): Promise<UsageMonitoringResult> {
  let usagePoll: ReturnType<typeof setInterval> | undefined;
  let usageUnsubscribe: (() => void) | undefined;

  if (options.codexAuth) {
    const recordCodexWindows = (windows: readonly CodexRateLimitWindow[]) => {
      for (const window of windows) {
        options.usage.recordWindow({
          provider: 'codex',
          windowType: window.name,
          utilization: window.utilization,
          remaining: window.remaining,
          resetsAt: window.resetsAt,
          capturedAt: Date.now(),
          payload: window,
        });
      }
    };
    const refreshCodexUsage = async () => {
      recordCodexWindows(await options.codexAuth!.readRateLimits());
    };
    usageUnsubscribe = options.codexAuth.onRateLimitsUpdated(recordCodexWindows);
    await refreshCodexUsage().catch(error => {
      console.warn('[runtime] Failed to read Codex usage:', redactErrorMessage(error));
    });
    if (!options.disableUsagePolling) {
      usagePoll = setInterval(() => {
        void refreshCodexUsage().catch(error => {
          console.warn('[runtime] Failed to refresh Codex usage:', redactErrorMessage(error));
        });
      }, 60_000);
      usagePoll.unref?.();
    }
  }

  let stopped = false;
  return {
    ...(usagePoll ? { usagePoll } : {}),
    ...(usageUnsubscribe ? { usageUnsubscribe } : {}),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (usagePoll) clearInterval(usagePoll);
      usageUnsubscribe?.();
    },
  };
}

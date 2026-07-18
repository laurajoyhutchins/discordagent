import type { AgentProviderId, ProviderUsage, TaskResult } from '../agents/contracts.js';
import type {
  UsageRepository,
  UsageReservation,
  UsageSnapshot,
} from '../repositories/usageRepository.js';

export type UsagePosture = 'unknown' | 'healthy' | 'cautious' | 'restricted' | 'preserve' | 'exhausted';

export interface UsagePostureState {
  posture: UsagePosture;
  available?: number;
  reserved: number;
}

export class UsageAdmissionError extends Error {
  constructor(
    message: string,
    readonly posture: UsagePosture,
    readonly recommendation: string,
  ) {
    super(message);
  }
}

export interface UsageAdmissionService {
  reserve(input: { provider: AgentProviderId; prompt: string }): Promise<UsageReservation>;
  attach(reservationId: string, taskId: string): void;
  release(reservationId: string): void;
  complete(reservationId: string, result: TaskResult): void;
  recordUsage(provider: AgentProviderId, usage: ProviderUsage): void;
  recordWindow(snapshot: UsageSnapshot): void;
  posture(provider: AgentProviderId): UsagePostureState;
  reservations(provider?: AgentProviderId): UsageReservation[];
  detail(): string;
}

const DEFAULT_ESTIMATES: Record<string, [number, number]> = {
  conversation: [1, 2],
  orientation: [2, 4],
  review: [3, 7],
  small_fix: [4, 9],
  contained_feature: [6, 14],
  cross_cutting_feature: [12, 25],
  refactor: [18, 40],
  research: [4, 12],
};

function classify(prompt: string): string {
  const normalized = prompt.toLowerCase();
  if (/refactor|repository-wide|rewrite/.test(normalized)) return 'refactor';
  if (/review|pull request|\bpr\b/.test(normalized)) return 'review';
  if (/investigate|research|analy[sz]e/.test(normalized)) return 'research';
  if (/fix|bug|error/.test(normalized)) return 'small_fix';
  if (/architecture|across|multiple packages/.test(normalized)) return 'cross_cutting_feature';
  if (/implement|add|build/.test(normalized)) return 'contained_feature';
  return 'conversation';
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value <= 1 ? value * 100 : value;
}

export function createUsageAdmissionService(
  repository: UsageRepository,
  options: { primaryReserve?: number | (() => number) } = {},
): UsageAdmissionService {
  const primaryReserve = () => typeof options.primaryReserve === 'function'
    ? options.primaryReserve()
    : options.primaryReserve ?? 10;

  function posture(provider: AgentProviderId): UsagePostureState {
    const remaining = repository.latestSnapshots(provider)
      .map(snapshot => snapshot.remaining)
      .filter((value): value is number => value !== undefined);
    const available = remaining.length > 0 ? Math.min(...remaining) : undefined;
    const reserved = repository.activeReservations(provider)
      .reduce((total, reservation) => total + reservation.high, 0);
    const effective = available === undefined ? undefined : available - reserved;
    const state: UsagePosture = effective === undefined
      ? 'unknown'
      : effective <= 0
        ? 'exhausted'
        : effective < 10
          ? 'preserve'
          : effective < 25
            ? 'restricted'
            : effective < 50
              ? 'cautious'
              : 'healthy';
    return { posture: state, available, reserved };
  }

  function recordWindow(snapshot: UsageSnapshot): void {
    repository.recordSnapshot(snapshot);
  }

  return {
    async reserve(input) {
      const taskClass = classify(input.prompt);
      const observed = repository.observations(input.provider, taskClass).map(item => item.actualCost);
      const defaults = DEFAULT_ESTIMATES[taskClass] ?? DEFAULT_ESTIMATES.contained_feature;
      const low = observed.length >= 3 ? percentile(observed, 0.5) : defaults[0];
      const high = observed.length >= 5 ? Math.max(low, percentile(observed, 0.9)) : defaults[1];
      const confidence = observed.length >= 8 ? 'high' : observed.length >= 3 ? 'medium' : 'low';
      const state = posture(input.provider);
      const uncommitted = state.available === undefined ? undefined : state.available - state.reserved;

      if (uncommitted !== undefined && high + primaryReserve() > uncommitted) {
        const recommendation = uncommitted > low
          ? 'Narrow the scope or split planning from implementation.'
          : 'Defer the task or use another authenticated provider.';
        throw new UsageAdmissionError(
          'I do not think this task can be completed and verified reliably with the currently available provider capacity.',
          state.posture,
          recommendation,
        );
      }

      return repository.createHold({
        provider: input.provider,
        taskClass,
        low,
        high,
        confidence,
      });
    },

    attach(reservationId, taskId) {
      repository.attachTask(reservationId, taskId);
    },

    release(reservationId) {
      repository.finish(reservationId, 'released');
    },

    complete(reservationId, result) {
      const active = repository.activeReservations().find(item => item.id === reservationId);
      if (!active) return;
      const actual = result.usage?.utilization !== undefined
        ? normalizePercent(result.usage.utilization)!
        : result.usage?.totalTokens
          ? result.usage.totalTokens / 100_000
          : result.outcome === 'failed'
            ? 0
            : active.high;
      repository.finish(reservationId, 'consumed', actual);
      repository.recordObservation({
        provider: active.provider,
        taskClass: active.taskClass,
        actualCost: actual,
        ...(result.usage?.totalTokens ? { tokenCount: result.usage.totalTokens } : {}),
        ...(result.durationMs ? { durationMs: result.durationMs } : {}),
        recordedAt: Date.now(),
      });
    },

    recordUsage(provider, usage) {
      if (usage.utilization === undefined && usage.resetsAt === undefined) return;
      const utilization = normalizePercent(usage.utilization);
      recordWindow({
        provider,
        windowType: 'turn',
        utilization,
        remaining: utilization === undefined ? undefined : Math.max(0, 100 - utilization),
        resetsAt: usage.resetsAt,
        capturedAt: Date.now(),
        payload: usage,
      });
    },

    recordWindow,
    posture,

    reservations(provider) {
      return repository.activeReservations(provider);
    },

    detail() {
      return (['claude', 'codex'] as const).map(provider => {
        const state = posture(provider);
        const availability = state.available === undefined ? '' : `, ${state.available.toFixed(1)} available`;
        return `${provider}: ${state.posture}${availability}, ${state.reserved.toFixed(1)} reserved`;
      }).join('\n');
    },
  };
}

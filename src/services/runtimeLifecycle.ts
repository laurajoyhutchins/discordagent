export type RuntimeStop = () => void | Promise<void>;

export interface RuntimeLifecycleError {
  owner: string;
  error: unknown;
}

export interface RuntimeLifecycleOptions {
  onError?: (failure: RuntimeLifecycleError) => void;
}

interface RuntimeLifecycleEntry {
  owner: string;
  stop: RuntimeStop;
  stopped: boolean;
}

/**
 * Owns runtime cleanup callbacks and executes them exactly once in reverse
 * acquisition order. Cleanup failures are reported without preventing later
 * owners from releasing their resources.
 */
export class RuntimeLifecycle {
  private readonly entries: RuntimeLifecycleEntry[] = [];
  private readonly onError: (failure: RuntimeLifecycleError) => void;
  private stopPromise: Promise<void> | undefined;

  constructor(options: RuntimeLifecycleOptions = {}) {
    this.onError = options.onError ?? (() => undefined);
  }

  defer(owner: string, stop: RuntimeStop): void {
    if (this.stopPromise) {
      throw new Error(`Cannot register runtime lifecycle owner "${owner}" after teardown has started`);
    }
    this.entries.push({ owner, stop, stopped: false });
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopEntries();
    return this.stopPromise;
  }

  private async stopEntries(): Promise<void> {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry.stopped) continue;
      entry.stopped = true;
      try {
        await entry.stop();
      } catch (error) {
        this.onError({ owner: entry.owner, error });
      }
    }
  }
}

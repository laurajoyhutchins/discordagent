export interface ReviewNotification {
  source: string;
  projectId: string;
  revision?: string;
  status: 'started' | 'passed' | 'warning' | 'failed';
  summary: string;
  details?: Record<string, unknown>;
}

export interface ReviewSource {
  readonly id: string;
  start(
    publish: (notification: ReviewNotification) => Promise<void>,
  ): Promise<Disposable>;
}

export interface Disposable {
  dispose(): Promise<void>;
}

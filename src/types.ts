export interface Project {
  name: string;
  workingDirectory: string;
  categoryId: string;
  claudeChannelId: string;
  roborevChannelId: string;
  roborevWebhookId: string;
  roborevWebhookToken: string;
  sessionId?: string; // Persisted session ID for resume
}

export interface ProjectStore {
  projects: Project[];
}

export interface ActiveSession {
  abortController: AbortController;
  channelId: string;
  threadId: string;
  projectName: string;
  sessionId: string | null;
  startedAt: number;
  busy: boolean; // Currently processing a query
}

export interface RoborevEvent {
  type: string;
  repo?: string;
  file?: string;
  line?: number;
  severity?: 'info' | 'warning' | 'error';
  message?: string;
  suggestion?: string;
  commit?: string;
  author?: string;
}

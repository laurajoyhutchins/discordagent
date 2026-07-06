export interface Project {
  name: string;
  workingDirectory: string;
  categoryId: string;
  claudeChannelId: string;
  roborevChannelId?: string;
  roborevWebhookId?: string;
  roborevWebhookToken?: string;
  sessionId?: string; // Persisted session ID for resume
  model?: string; // Per-project model override (set via /model command)
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


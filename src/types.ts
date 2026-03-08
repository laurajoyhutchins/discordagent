import type { Query } from '@anthropic-ai/claude-agent-sdk';

export interface Project {
  name: string;
  workingDirectory: string;
  categoryId: string;
  claudeChannelId: string;
  roborevChannelId: string;
  roborevWebhookId: string;
  roborevWebhookToken: string;
}

export interface ProjectStore {
  projects: Project[];
}

export interface ActiveSession {
  query: Query;
  abortController: AbortController;
  channelId: string;
  threadId: string;
  projectName: string;
  sessionId: string | null;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
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

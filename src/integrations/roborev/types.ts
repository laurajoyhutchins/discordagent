export interface RoborevStreamEvent {
  type: string;
  ts: string;
  job_id: number;
  repo: string;
  repo_name: string;
  sha: string;
  agent: string;
  verdict?: string;
}

export interface VerdictConfig {
  color: number;
  label: string;
  emoji: string;
}

export type VerdictGrade = 'A' | 'B' | 'C' | 'D' | 'F';

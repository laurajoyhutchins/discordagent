import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { MemoryRepository } from '../repositories/memoryRepository.js';
import type { UsageAdmissionService } from '../services/usageAdmission.js';

export function createContextAssembler(deps: { projects: ProjectRepository; tasks: TaskRepository; messages: MessageRepository; memories: MemoryRepository; usage?: UsageAdmissionService }) {
  return {
    assemble(input: { channelId: string; query: string }): string {
      const memories = ['policy','user','goals','projects','decisions'].flatMap(ns => deps.memories.list(ns)).slice(0, 40);
      const projects = deps.projects.listActive();
      const active = deps.tasks.listActive();
      const recent = deps.messages.recent(input.channelId, 16);
      let retrieved: ReturnType<MessageRepository['search']> = [];
      try { retrieved = deps.messages.search(input.query.replace(/["'():*]/g, ' '), { channelId: input.channelId, limit: 8 }); } catch { retrieved = []; }
      return [
        'PINNED MEMORY', ...memories.map(m => `- ${m.namespace}/${m.key}: ${JSON.stringify(m.value)}`),
        'PROJECTS', ...projects.map(p => `- ${p.name}: provider=${p.defaultProvider}`),
        'ACTIVE TASKS', ...active.map(t => `- ${t.projectName}/${t.provider}/${t.status}: ${t.objective}`),
        'USAGE POSTURE', deps.usage?.detail() ?? 'provider usage is not available',
        'RECENT CONVERSATION', ...recent.map(m => `${m.role}: ${m.content}`),
        'RELEVANT HISTORY', ...retrieved.map(m => `${m.role}: ${m.content}`),
      ].join('\n').slice(0, 28_000);
    },
  };
}
export type ContextAssembler = ReturnType<typeof createContextAssembler>;

import type { CapabilityEvaluation, CapabilityReport } from './contracts.js';

const SECTIONS: Readonly<Record<string, readonly string[]>> = {
  'Core runtime': ['core.guild.access', 'core.channel.view', 'core.message.send', 'core.message.history'],
  'Task threads': ['task.thread.create.public', 'task.thread.send', 'task.thread.manage'],
  'Task presentation': ['task.control-card.pin', 'decision.poll.send'],
  'Workspace bootstrap': ['workspace.channel.manage', 'workspace.role.manage'],
  'Optional integrations': ['workspace.webhook.manage', 'event.create', 'audit.read', 'voice.message.send', 'voice.connect', 'voice.speak', 'voice.status.set'],
  'Gateway/application configuration': ['activity.launch'],
};

function marker(evaluation: CapabilityEvaluation): string {
  switch (evaluation.state) {
    case 'available': return 'available';
    case 'unavailable': return evaluation.required ? 'missing (required)' : 'unavailable (optional)';
    case 'not_applicable': return 'application/configuration feature';
    case 'cannot_determine': return 'unknown';
  }
}

export function formatCapabilityReport(report: CapabilityReport): string {
  const byId = new Map(report.evaluations.map(evaluation => [evaluation.capabilityId, evaluation]));
  const sections = Object.entries(SECTIONS).map(([title, ids]) => {
    const lines = ids.flatMap(id => {
      const evaluation = byId.get(id);
      if (!evaluation) return [];
      const detail = evaluation.state === 'available'
        ? evaluation.reason
        : `${evaluation.reason} Fallback: ${evaluation.fallback} Enable with: ${evaluation.remediation}`;
      return `- ${id}: ${marker(evaluation)}. ${detail}`;
    });
    return `**${title}**\n${lines.length ? lines.join('\n') : '- No capabilities evaluated.'}`;
  });
  return sections.join('\n\n');
}

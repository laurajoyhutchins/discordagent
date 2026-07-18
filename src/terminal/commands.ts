import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { SettingsService } from '../services/settingsService.js';
import type { AgentProviderId } from '../agents/contracts.js';
import { isAgentProviderId } from '../agents/contracts.js';
import { providerLabel } from '../agents/providerLabels.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface CommandContext {
  projects: ProjectRepository;
  tasks: TaskRepository;
  providers: ProviderRegistry;
  settings: SettingsService;
  currentProject?: string;
  isDiscordConnected?: () => boolean;
}

export interface CommandResult {
  text: string;
  exit?: boolean;
  clear?: boolean;
  projectChanged?: string;
  providerChanged?: string;
  modelChanged?: string;
}

export async function handleCommand(
  input: string,
  ctx: CommandContext,
): Promise<CommandResult | null> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case '/help':
      return {
        text: [
          'Discord Agent terminal REPL',
          '',
          '  /help                 Show this help',
          '  /status               Show runtime information',
          '  /projects             List registered projects',
          '  /project <name>       Set the current project context',
          '  /provider             Show current primary provider',
          '  /provider <name>      Change the primary provider (claude|codex|opencode)',
          '  /model                Show active model',
          '  /model <name>         Set the primary agent model',
          '  /tasks                List active or recent tasks',
          '  /clear                Clear the terminal display',
          '  /exit                 Stop the REPL (bot continues running)',
          '',
          'Any other text is sent to the primary PM agent.',
        ].join('\n'),
      };

    case '/status':
      return { text: buildStatus(ctx) };

    case '/projects':
      return { text: buildProjectList(ctx) };

    case '/project':
      if (args.length === 0) {
        if (ctx.currentProject) {
          return { text: `Current project: ${ctx.currentProject}` };
        }
        return { text: 'No project selected. Use /project <name> to set one.' };
      }
      return handleSetProject(args[0], ctx);

    case '/provider':
      return handleProvider(args, ctx);

    case '/model':
      return handleModel(args, ctx);

    case '/tasks':
      return { text: buildTaskList(ctx) };

    case '/clear':
      return { clear: true, text: '' };

    case '/exit':
      return { exit: true, text: 'REPL stopped.' };

    default:
      return { text: `Unknown command: ${command}. Type /help for available commands.` };
  }
}

function buildStatus(ctx: CommandContext): string {
  const lines: string[] = ['Discord Agent'];
  const discordStatus = ctx.isDiscordConnected?.() ?? true;
  lines.push(`  Discord: ${discordStatus ? 'connected' : 'disconnected'}`);
  const globalSetting = ctx.settings.global();
  const provider = globalSetting.defaultProvider;
  lines.push(`  Primary provider: ${provider ? providerLabel(provider) : 'not configured'}`);
  if (ctx.currentProject) {
    const project = ctx.projects.findByName(ctx.currentProject);
    if (project) {
      lines.push(`  Terminal project: ${ctx.currentProject} (${providerLabel(project.defaultProvider)})`);
    } else {
      lines.push(`  Terminal project: ${ctx.currentProject} (not found)`);
    }
  }
  try {
    const liveProviders = ctx.providers.list();
    lines.push(`  Available providers: ${liveProviders.map(p => providerLabel(p)).join(', ') || 'none'}`);
  } catch {
    lines.push('  Available providers: unknown');
  }
  const activeTasks = ctx.tasks.listActive();
  if (activeTasks.length > 0) {
    lines.push(`  Active tasks: ${activeTasks.length}`);
    for (const task of activeTasks.slice(0, 5)) {
      lines.push(`    ${task.projectName}/${task.provider}: ${task.objective.slice(0, 60)}`);
    }
  } else {
    lines.push('  Active tasks: none');
  }
  lines.push('  Runtime: ready');
  return lines.join('\n');
}

function buildProjectList(ctx: CommandContext): string {
  const projects = ctx.projects.listActive();
  if (projects.length === 0) return 'No projects registered.';
  const lines = ['Registered projects:'];
  for (const p of projects) {
    const current = p.name === ctx.currentProject ? ' <-- current' : '';
    lines.push(`  ${p.name} (${providerLabel(p.defaultProvider)})${current}`);
  }
  return lines.join('\n');
}

async function handleSetProject(name: string, ctx: CommandContext): Promise<CommandResult> {
  const project = ctx.projects.findByName(name);
  if (!project) return { text: `Project "${name}" is not registered. Use /projects to list available projects.` };
  return { text: `Project context set to "${project.name}" (${providerLabel(project.defaultProvider)}).`, projectChanged: name };
}

async function handleProvider(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (args.length === 0) {
    const globalSetting = ctx.settings.global();
    const provider = globalSetting.defaultProvider;
    return { text: `Current primary provider: ${provider ? providerLabel(provider) : 'not configured'}` };
  }

  const requested = args[0].toLowerCase();
  if (!isAgentProviderId(requested)) {
    return { text: 'Provider must be claude, codex, or opencode.' };
  }

  const available = ctx.providers.list();
  if (!available.includes(requested)) {
    return { text: `${providerLabel(requested)} is unavailable on this host.` };
  }

  try {
    const availability = await ctx.providers.availability(requested);
    if (!availability.available) {
      const reason = availability.reason ? `: ${redactErrorMessage(availability.reason)}` : '';
      return { text: `${providerLabel(requested)} is unavailable${reason}.` };
    }
  } catch (error) {
    return { text: `Failed to check ${providerLabel(requested)} availability: ${redactErrorMessage(error)}` };
  }

  return { text: `Primary provider set to ${providerLabel(requested)}.`, providerChanged: requested };
}

async function handleModel(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const globalSetting = ctx.settings.global();
  const provider = globalSetting.defaultProvider;

  if (args.length === 0) {
    if (!provider) return { text: 'No provider configured. Use /provider first.' };
    const modelKey = provider === 'claude' ? 'claudeModel' : provider === 'codex' ? 'codexModel' : 'openCodeModel';
    const record = globalSetting as Record<string, string | undefined>;
    const current = record.primaryAgentModel ?? record[modelKey] ?? 'provider default';
    return { text: `Current ${providerLabel(provider)} model: ${current}` };
  }
  if (!provider) return { text: 'No provider configured. Use /provider first.' };

  const modelName = args[0];

  // Update primaryAgentModel, which has highest precedence in model resolution.
  // Provider-specific project overrides remain available through Discord commands.
  ctx.settings.updateGlobal({ primaryAgentModel: modelName });

  return { text: `${providerLabel(provider)} model set to "${modelName}".`, modelChanged: modelName };
}

function buildTaskList(ctx: CommandContext): string {
  const active = ctx.tasks.listActive();
  const lines: string[] = [];

  if (active.length > 0) {
    lines.push(`Active tasks (${active.length}):`);
    for (const task of active) {
      const elapsed = formatDuration(Date.now() - task.createdAt);
      lines.push(`  ${task.projectName}/${task.provider} [${task.status}] ${task.objective.slice(0, 80)} (${elapsed})`);
    }
  } else {
    lines.push('No active tasks.');
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

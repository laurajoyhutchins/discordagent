import * as readline from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import type { PrimaryConversationService, ProcessResult } from '../primary/primaryConversationService.js';
import type { PrimaryTaskProposal } from '../primary/primaryModel.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import type { TaskRepository } from '../repositories/taskRepository.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { SettingsService } from '../services/settingsService.js';
import type { AgentProviderId } from '../agents/contracts.js';
import { UsageAdmissionError } from '../services/usageAdmission.js';
import { handleCommand, type CommandContext } from './commands.js';
import { sanitizeTerminalError, renderUserReply } from './renderer.js';

export const TERMINAL_CONVERSATION_ID = 'terminal:primary';

export interface ReplDependencies {
  conversationService: PrimaryConversationService;
  ownerId: string;
  displayName?: string;
  projects: ProjectRepository;
  tasks: TaskRepository;
  providers: ProviderRegistry;
  settings: SettingsService;
  onShutdown?: () => void;
  activatePrimaryProvider?: (provider: AgentProviderId) => Promise<unknown>;
  isDiscordConnected?: () => boolean;
}

enum ReplState {
  Idle,
  WaitingForTaskConfirm,
  WaitingForDecision,
  ShuttingDown,
  Stopped,
}

interface PendingTaskProposal {
  kind: 'task-confirm';
  proposal: PrimaryTaskProposal;
}

interface PendingDecision {
  kind: 'decision';
  prompt: string;
  options: string[];
}

type PendingInteraction = PendingTaskProposal | PendingDecision;

export class Repl {
  private rl: readline.Interface | null = null;
  private state = ReplState.Idle;
  private currentProject: string | undefined;
  private pending: PendingInteraction | null = null;
  private deps: ReplDependencies;
  private inputQueue: Array<() => Promise<void>> = [];
  private processing = false;
  private output: NodeJS.WritableStream;
  private input: NodeJS.ReadableStream;

  constructor(deps: ReplDependencies) {
    this.deps = deps;
    this.output = processStdout;
    this.input = processStdin;
  }

  get isRunning(): boolean {
    return this.state !== ReplState.Stopped;
  }

  get currentProjectName(): string | undefined {
    return this.currentProject;
  }

  setStreams(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
    this.input = input;
    this.output = output;
  }

  async start(): Promise<void> {
    if (this.state === ReplState.Stopped) return;
    if (this.rl) return;

    this.state = ReplState.Idle;

    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
      prompt: renderUserReply(this.deps.displayName ?? this.deps.ownerId),
      terminal: true,
    });

    this.rl.on('SIGINT', () => {
      this.writeLine('^C');
      this.deps.onShutdown?.();
    });

    this.writeLine('Terminal REPL connected. Type /help for commands.');
    this.rl.prompt();

    this.rl.on('line', (line: string) => {
      this.enqueueLine(line);
    });

    this.rl.on('close', () => {
      this.state = ReplState.Stopped;
    });
  }

  async processLine(line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.inputQueue.push(async () => {
        try {
          await this.handleLine(line);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      void this.drainQueue();
    });
  }

  async stop(): Promise<void> {
    if (this.state === ReplState.Stopped) return;
    this.state = ReplState.ShuttingDown;
    this.inputQueue.length = 0;
    const rl = this.rl;
    this.rl = null;
    if (rl) {
      rl.close();
    }
    this.state = ReplState.Stopped;
  }

  private enqueueLine(line: string): void {
    this.inputQueue.push(() => this.handleLine(line));
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.inputQueue.length > 0) {
        if (this.state === ReplState.ShuttingDown || this.state === ReplState.Stopped) break;
        const task = this.inputQueue.shift()!;
        await task();
      }
    } finally {
      this.processing = false;
    }
  }

  private writeLine(text: string): void {
    this.output.write(`${text}\n`);
  }

  private write(text: string): void {
    this.output.write(text);
  }

  private async handleLine(line: string): Promise<void> {
    if (this.state === ReplState.ShuttingDown || this.state === ReplState.Stopped) return;

    try {
      if (this.state === ReplState.WaitingForTaskConfirm) {
        await this.handleTaskConfirm(line);
        return;
      }
      if (this.state === ReplState.WaitingForDecision) {
        await this.handleDecisionInput(line);
        return;
      }

      await this.handleNormalInput(line);
    } finally {
      const currentState: number = this.state;
      if (this.rl && currentState !== ReplState.Stopped && currentState !== ReplState.ShuttingDown) {
        this.rl.prompt();
      }
    }
  }

  private async handleNormalInput(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const commandCtx: CommandContext = {
      projects: this.deps.projects,
      tasks: this.deps.tasks,
      providers: this.deps.providers,
      settings: this.deps.settings,
      currentProject: this.currentProject,
      isDiscordConnected: this.deps.isDiscordConnected,
    };

    const cmdResult = await handleCommand(trimmed, commandCtx);
    if (cmdResult) {
      if (cmdResult.exit) {
        this.writeLine(cmdResult.text);
        await this.stop();
        this.deps.onShutdown?.();
        return;
      }
      if (cmdResult.clear) {
        this.clearScreen();
        return;
      }
      if (cmdResult.projectChanged !== undefined) {
        this.currentProject = cmdResult.projectChanged;
      }
      if (cmdResult.providerChanged !== undefined && this.deps.activatePrimaryProvider) {
        try {
          await this.deps.activatePrimaryProvider(cmdResult.providerChanged as AgentProviderId);
        } catch (error) {
          this.writeLine(`agent> Failed to activate provider: ${sanitizeTerminalError(error)}`);
        }
      }
      if (cmdResult.modelChanged !== undefined && this.deps.activatePrimaryProvider) {
        const globalSetting = this.deps.settings.global();
        const provider = globalSetting.defaultProvider as AgentProviderId | undefined;
        if (provider) {
          try {
            await this.deps.activatePrimaryProvider(provider);
          } catch (error) {
            this.writeLine(`agent> Model change will apply next time: ${sanitizeTerminalError(error)}`);
          }
        }
      }
      if (cmdResult.text) {
        this.writeLine(cmdResult.text);
      }
      return;
    }

    const result = await this.deps.conversationService.process({
      conversationId: TERMINAL_CONVERSATION_ID,
      userId: this.deps.ownerId,
      text: trimmed,
      currentProjectName: this.currentProject,
    });

    await this.renderProcessResult(result);
  }

  private async renderProcessResult(result: ProcessResult): Promise<void> {
    if (result.kind === 'reply') {
      this.writeLine(`agent> ${result.text}`);
      return;
    }

    if (result.kind === 'usage-rejected') {
      this.writeLine(`agent> ${result.text}`);
      this.writeLine(`       ${result.recommendation}`);
      return;
    }

    if (result.kind === 'task-proposal') {
      this.writeLine(`agent> ${result.text}`);
      this.writeLine('');
      this.writeLine(`Proposed task`);
      this.writeLine(`  Project:   ${result.proposal.projectName}`);
      this.writeLine(`  Objective: ${result.proposal.objective}`);
      if (result.proposal.rationale) {
        this.writeLine(`  Rationale: ${result.proposal.rationale}`);
      }

      if (result.explicit) {
        this.writeLine('');
        try {
          await this.deps.conversationService.launchTask(result.proposal);
          this.writeLine('agent> Task started.');
        } catch (error) {
          if (error instanceof UsageAdmissionError) {
            this.writeLine(`agent> ${error.message}`);
            this.writeLine(`       ${error.recommendation}`);
          } else {
            this.writeLine(`agent> ${sanitizeTerminalError(error)}`);
          }
        }
        return;
      }

      this.state = ReplState.WaitingForTaskConfirm;
      this.pending = { kind: 'task-confirm', proposal: result.proposal };
      this.writeLine('');
      this.writeLine('  [1] Start task');
      this.writeLine('  [2] Cancel');
      this.writeLine('');
      this.write('choice> ');
      return;
    }

    if (result.kind === 'decision') {
      this.writeLine(`agent> ${result.text}`);

      const options = result.decision.options.length >= 2
        ? result.decision.options.slice(0, result.decision.kind === 'select' ? 25 : 2)
        : ['Proceed', 'Cancel'];

      this.state = ReplState.WaitingForDecision;
      this.pending = { kind: 'decision', prompt: result.decision.prompt, options };
      this.writeLine('');
      for (let i = 0; i < options.length; i++) {
        this.writeLine(`  [${i + 1}] ${options[i]}`);
      }
      this.writeLine('');
      this.writeLine('  Enter a number, or q to cancel.');
      this.write('choice> ');
      return;
    }
  }

  private async handleTaskConfirm(line: string): Promise<void> {
    const trimmed = line.trim().toLowerCase();
    const pending = this.pending as PendingTaskProposal;

    if (trimmed === 'q' || trimmed === 'cancel') {
      this.state = ReplState.Idle;
      this.pending = null;
      this.writeLine('Cancelled.');
      return;
    }

    if (trimmed === '1') {
      this.state = ReplState.Idle;
      this.pending = null;
      this.writeLine('Starting the delegated task…');
      try {
        await this.deps.conversationService.launchTask(pending.proposal);
        this.writeLine('agent> Task started.');
      } catch (error) {
        if (error instanceof UsageAdmissionError) {
          this.writeLine(`agent> ${error.message}`);
          this.writeLine(`       ${error.recommendation}`);
        } else {
          this.writeLine(`agent> ${sanitizeTerminalError(error)}`);
        }
      }
      return;
    }

    if (trimmed === '2') {
      this.state = ReplState.Idle;
      this.pending = null;
      this.writeLine('Task proposal cancelled.');
      return;
    }

    this.writeLine(`Invalid choice. Enter 1 to start, 2 to cancel.`);
    this.writeLine('');
    this.writeLine('  [1] Start task');
    this.writeLine('  [2] Cancel');
    this.writeLine('');
    this.write('choice> ');
  }

  private async handleDecisionInput(line: string): Promise<void> {
    const trimmed = line.trim().toLowerCase();
    const pending = this.pending as PendingDecision;

    if (trimmed === 'q' || trimmed === 'cancel') {
      this.state = ReplState.Idle;
      this.pending = null;
      this.writeLine('Cancelled.');
      return;
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1 || num > pending.options.length) {
      let msg = `Invalid choice. Enter a number between 1 and ${pending.options.length}`;
      msg += ', or q to cancel.';
      this.writeLine(msg);
      this.writeLine('');
      for (let i = 0; i < pending.options.length; i++) {
        this.writeLine(`  [${i + 1}] ${pending.options[i]}`);
      }
      this.writeLine('');
      this.writeLine('  Enter a number, or q to cancel.');
      this.write('choice> ');
      return;
    }

    const selectedOption = pending.options[num - 1];
    this.state = ReplState.Idle;
    this.pending = null;

    const result = await this.deps.conversationService.resolveDecision({
      conversationId: TERMINAL_CONVERSATION_ID,
      userId: this.deps.ownerId,
      decisionPrompt: pending.prompt,
      selectedOption,
      currentProjectName: this.currentProject,
    });

    await this.renderProcessResult(result);
  }

  private clearScreen(): void {
    this.output.write('\x1b[2J\x1b[0;0H');
  }
}

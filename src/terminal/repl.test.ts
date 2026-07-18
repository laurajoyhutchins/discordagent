import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Writable, Readable } from 'node:stream';
import { Repl, TERMINAL_CONVERSATION_ID } from './repl.js';

function createMockDeps(overrides: Record<string, unknown> = {}) {
  const conversationService = {
    process: vi.fn().mockResolvedValue({ kind: 'reply', text: 'Hello.' }),
    resolveDecision: vi.fn().mockResolvedValue({ kind: 'reply', text: 'Done.' }),
    launchTask: vi.fn().mockResolvedValue(undefined),
  };
  const projects = {
    listActive: vi.fn().mockReturnValue([]),
    findByName: vi.fn().mockReturnValue(undefined),
  };
  const tasks = {
    listActive: vi.fn().mockReturnValue([]),
  };
  const providers = {
    list: vi.fn().mockReturnValue(['codex']),
    availability: vi.fn().mockResolvedValue({ available: true }),
  };
  const settings = {
    global: vi.fn().mockReturnValue({ defaultProvider: 'codex', claudeModel: 'claude-3' }),
    updateGlobal: vi.fn().mockReturnValue({}),
  };
  const onShutdown = vi.fn();

  return {
    ...overrides,
    conversationService,
    projects,
    tasks,
    providers,
    settings,
    ownerId: 'test-user',
    onShutdown,
  } as never;
}

describe('Repl', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
  });

  function createRepl(deps: Record<string, unknown> = {}): Repl {
    return new Repl(createMockDeps(deps));
  }

  function collectOutput(repl: Repl): string[] {
    return output;
  }

  it('start and stop', async () => {
    const repl = createRepl();
    await repl.start();
    expect(repl.isRunning).toBe(true);
    await repl.stop();
    expect(repl.isRunning).toBe(false);
  });

  it('processes /help command', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/help');
    expect(deps.settings.global).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /status command', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/status');
    expect(deps.settings.global).toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /projects command', async () => {
    const deps = createMockDeps() as any;
    deps.projects.listActive.mockReturnValue([
      { name: 'test-project', defaultProvider: 'codex' },
    ]);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/projects');
    expect(deps.projects.listActive).toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /project with valid name', async () => {
    const deps = createMockDeps() as any;
    deps.projects.findByName.mockReturnValue({ name: 'test-project', defaultProvider: 'codex' });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/project test-project');
    expect(deps.projects.findByName).toHaveBeenCalledWith('test-project');
    await repl.stop();
  });

  it('processes /project with invalid name', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/project nonexistent');
    expect(deps.projects.findByName).toHaveBeenCalledWith('nonexistent');
    await repl.stop();
  });

  it('processes /provider display', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider');
    expect(deps.settings.global).toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /provider change to valid provider', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex', 'opencode']);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    expect(deps.settings.updateGlobal).toHaveBeenCalledWith({ defaultProvider: 'opencode' });
    await repl.stop();
  });

  it('processes /provider change to invalid provider', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider invalid');
    expect(deps.settings.updateGlobal).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /provider change to unavailable provider', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex']);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    expect(deps.settings.updateGlobal).not.toHaveBeenCalledWith({ defaultProvider: 'opencode' });
    await repl.stop();
  });

  it('processes /model display', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/model');
    expect(deps.settings.global).toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /model change', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/model claude-3-haiku');
    expect(deps.settings.updateGlobal).toHaveBeenCalledWith({ primaryAgentModel: 'claude-3-haiku' });
    await repl.stop();
  });

  it('processes /tasks command', async () => {
    const deps = createMockDeps() as any;
    deps.tasks.listActive.mockReturnValue([
      { id: 'task-1', projectName: 'test', provider: 'codex', status: 'running', objective: 'Fix bug', createdAt: Date.now() - 120_000 },
    ]);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/tasks');
    expect(deps.tasks.listActive).toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /clear command without deleting data', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/clear');
    expect(deps.conversationService.process).not.toHaveBeenCalled();
    expect(deps.projects.listActive).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('processes /exit command and triggers shutdown', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/exit');
    expect(repl.isRunning).toBe(false);
    expect(deps.onShutdown).toHaveBeenCalled();
    await repl.stop();
  });

  it('sends normal text through conversation service', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Hello agent!');
    expect(deps.conversationService.process).toHaveBeenCalledWith({
      conversationId: TERMINAL_CONVERSATION_ID,
      userId: 'test-user',
      text: 'Hello agent!',
    });
    await repl.stop();
  });

  it('handles reply kind', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({ kind: 'reply', text: 'Hello back!' });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Hi');
    await repl.stop();
  });

  it('handles task proposal with explicit intent', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'task-proposal',
      text: 'Starting.',
      proposal: { projectName: 'test', objective: 'Do it' },
      explicit: true,
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('go ahead');
    expect(deps.conversationService.launchTask).toHaveBeenCalled();
    await repl.stop();
  });

  it('transitions to choice mode for non-explicit task proposal', async () => {
    const deps = createMockDeps() as any;
    const launchTask = vi.fn().mockResolvedValue(undefined);
    deps.conversationService.process.mockResolvedValue({
      kind: 'task-proposal',
      text: 'I propose a task.',
      proposal: { projectName: 'test', objective: 'Do something' },
      explicit: false,
    });
    deps.conversationService.resolveDecision.mockResolvedValue({ kind: 'reply', text: 'Done.' });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Propose something');
    // Should be in choice mode now
    // Enter '1' to start
    await repl.processLine('1');
    expect(deps.conversationService.launchTask).toHaveBeenCalledWith({ projectName: 'test', objective: 'Do something' });
    await repl.stop();
  });

  it('handles task proposal cancellation', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'task-proposal',
      text: 'I propose a task.',
      proposal: { projectName: 'test', objective: 'Do something' },
      explicit: false,
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Propose something');
    await repl.processLine('2');
    expect(deps.conversationService.launchTask).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('handles invalid numbered input', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'task-proposal',
      text: 'I propose a task.',
      proposal: { projectName: 'test', objective: 'Do something' },
      explicit: false,
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Propose something');
    // Invalid input should not crash
    await repl.processLine('99');
    // Still in choice mode, enter valid input
    await repl.processLine('1');
    expect(deps.conversationService.launchTask).toHaveBeenCalled();
    await repl.stop();
  });

  it('handles decision prompt', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'decision',
      text: 'Please choose.',
      decision: { kind: 'confirm', prompt: 'Proceed?', options: ['Yes', 'No'] },
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Decide something');
    await repl.processLine('1');
    expect(deps.conversationService.resolveDecision).toHaveBeenCalledWith({
      conversationId: TERMINAL_CONVERSATION_ID,
      userId: 'test-user',
      decisionPrompt: 'Proceed?',
      selectedOption: 'Yes',
    });
    await repl.stop();
  });

  it('handles poll decision as synchronous selection', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'decision',
      text: 'Vote.',
      decision: { kind: 'poll', prompt: 'Choose option', options: ['A', 'B', 'C'] },
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Poll');
    await repl.processLine('2');
    expect(deps.conversationService.resolveDecision).toHaveBeenCalledWith({
      conversationId: TERMINAL_CONVERSATION_ID,
      userId: 'test-user',
      decisionPrompt: 'Choose option',
      selectedOption: 'B',
    });
    await repl.stop();
  });

  it('serializes turn processing', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process
      .mockResolvedValueOnce({ kind: 'reply', text: 'First.' })
      .mockResolvedValueOnce({ kind: 'reply', text: 'Second.' });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('First message');
    await repl.processLine('Second message');
    expect(deps.conversationService.process).toHaveBeenCalledTimes(2);
    await repl.stop();
  });

  it('rejects concurrent processing', async () => {
    const deps = createMockDeps() as any;
    // While a turn is being processed, another line should be ignored
    const slowProcess = vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 100));
      return { kind: 'reply', text: 'Slow.' };
    });
    deps.conversationService.process = slowProcess;
    const repl = new Repl(deps);
    await repl.start();

    // Start processing first line
    const p1 = repl.processLine('First');

    // The processLine should return false for a second concurrent call
    const p2 = repl.processLine('Second');

    await Promise.all([p1, p2]);
    // Only one process call should have completed by now
    expect(slowProcess).toHaveBeenCalledTimes(1);
    await repl.stop();
  });

  it('handles usage-rejected result', async () => {
    const deps = createMockDeps() as any;
    deps.conversationService.process.mockResolvedValue({
      kind: 'usage-rejected',
      text: 'Cannot start work.',
      recommendation: 'Try again later.',
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Start task');
    // Should not throw
    await repl.stop();
  });

  it('shuts down gracefully', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.stop();
    expect(repl.isRunning).toBe(false);
  });
});

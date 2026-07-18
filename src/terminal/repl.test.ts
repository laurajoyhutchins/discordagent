import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
  const onExitRepl = vi.fn();
  const onSigintShutdown = vi.fn();
  const activatePrimaryProvider = vi.fn().mockResolvedValue(undefined);

  return {
    ...overrides,
    conversationService,
    projects,
    tasks,
    providers,
    settings,
    ownerId: 'test-user',
    displayName: 'user',
    onExitRepl,
    onSigintShutdown,
    activatePrimaryProvider,
  } as never;
}

describe('Repl', () => {
  beforeEach(() => {
  });

  function createRepl(deps: Record<string, unknown> = {}): Repl {
    return new Repl(createMockDeps(deps));
  }

  it('start and stop', async () => {
    const repl = createRepl();
    await repl.start();
    expect(repl.isRunning).toBe(true);
    await repl.stop();
    expect(repl.isRunning).toBe(false);
  });

  it('uses display name for prompt', async () => {
    const deps = createMockDeps() as any;
    deps.displayName = 'laura';
    const repl = new Repl(deps);
    await repl.start();
    expect(repl.isRunning).toBe(true);
    await repl.stop();
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

  it('passes project context through conversation input', async () => {
    const deps = createMockDeps() as any;
    deps.projects.findByName.mockReturnValue({ name: 'active-project', defaultProvider: 'codex' });
    const repl = new Repl(deps);
    await repl.start();
    // Set project first
    await repl.processLine('/project active-project');
    // Then send a message
    await repl.processLine('status?');
    expect(deps.conversationService.process).toHaveBeenCalledWith(expect.objectContaining({
      currentProjectName: 'active-project',
    }));
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

  it('processes /provider change — activates then persists on success', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex', 'opencode']);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    // Activation should happen BEFORE settings persistence
    const activationCall = deps.activatePrimaryProvider.mock.invocationCallOrder[0];
    const settingsCall = deps.settings.updateGlobal.mock.invocationCallOrder[0];
    expect(activationCall).toBeLessThan(settingsCall!);
    expect(deps.settings.updateGlobal).toHaveBeenCalledWith({ defaultProvider: 'opencode' });
    expect(deps.activatePrimaryProvider).toHaveBeenCalledWith('opencode');
    await repl.stop();
  });

  it('does not persist settings on activation failure', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex', 'opencode']);
    deps.activatePrimaryProvider.mockRejectedValue(new Error('Auth failed'));
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    // Settings should NOT have been updated after failed activation
    expect(deps.settings.updateGlobal).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('does not activate for unavailable providers', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex']);
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    expect(deps.activatePrimaryProvider).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('does not activate for invalid provider names', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider invalid');
    expect(deps.settings.updateGlobal).not.toHaveBeenCalled();
    expect(deps.activatePrimaryProvider).not.toHaveBeenCalled();
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

  it('processes /model change with primaryAgentModel precedence', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/model claude-3-haiku');
    // Should update primaryAgentModel (highest precedence), not provider-specific model
    expect(deps.settings.updateGlobal).toHaveBeenCalledWith({ primaryAgentModel: 'claude-3-haiku' });
    expect(deps.activatePrimaryProvider).toHaveBeenCalled();
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

  it('processes /exit command and triggers exit repl', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/exit');
    expect(repl.isRunning).toBe(false);
    expect(deps.onExitRepl).toHaveBeenCalled();
    expect(deps.onSigintShutdown).not.toHaveBeenCalled();
    await repl.stop();
  });

  it('triggers sigint shutdown on SIGINT', async () => {
    const deps = createMockDeps() as any;
    const repl = new Repl(deps);
    await repl.start();
    const rl = (repl as any).rl;
    rl?.emit('SIGINT');
    expect(deps.onSigintShutdown).toHaveBeenCalled();
    expect(deps.onExitRepl).not.toHaveBeenCalled();
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
      currentProjectName: undefined,
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
    deps.conversationService.process.mockResolvedValue({
      kind: 'task-proposal',
      text: 'I propose a task.',
      proposal: { projectName: 'test', objective: 'Do something' },
      explicit: false,
    });
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('Propose something');
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
    await repl.processLine('99');
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
      currentProjectName: undefined,
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
      currentProjectName: undefined,
    });
    await repl.stop();
  });

  it('serializes input processing with FIFO queue', async () => {
    const deps = createMockDeps() as any;
    const callOrder: number[] = [];
    deps.conversationService.process = vi.fn().mockImplementation(async (input: { text: string }) => {
      callOrder.push(parseInt(input.text, 10));
      await new Promise(r => setTimeout(r, 10));
      return { kind: 'reply', text: `Done ${input.text}` };
    });
    const repl = new Repl(deps);
    await repl.start();

    await Promise.all([
      repl.processLine('1'),
      repl.processLine('2'),
      repl.processLine('3'),
    ]);

    // All three should be processed in order
    expect(callOrder).toEqual([1, 2, 3]);
    expect(deps.conversationService.process).toHaveBeenCalledTimes(3);
    await repl.stop();
  });

  it('processes lines even when previous is still running', async () => {
    const deps = createMockDeps() as any;
    const callTimestamps: number[] = [];
    deps.conversationService.process = vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 20));
      callTimestamps.push(Date.now());
      return { kind: 'reply', text: 'Done.' };
    });
    const repl = new Repl(deps);
    await repl.start();

    const p1 = repl.processLine('First');
    const p2 = repl.processLine('Second');

    await Promise.all([p1, p2]);
    // Both should have been processed
    expect(deps.conversationService.process).toHaveBeenCalledTimes(2);
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
    await repl.stop();
  });

  it('handles activation failure without persisting', async () => {
    const deps = createMockDeps() as any;
    deps.providers.list.mockReturnValue(['codex', 'opencode']);
    deps.activatePrimaryProvider.mockRejectedValue(new Error('Provider not available'));
    const repl = new Repl(deps);
    await repl.start();
    await repl.processLine('/provider opencode');
    expect(deps.activatePrimaryProvider).toHaveBeenCalledWith('opencode');
    expect(deps.settings.updateGlobal).not.toHaveBeenCalled();
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

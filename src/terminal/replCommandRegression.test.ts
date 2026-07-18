import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Repl } from './repl.js';
import { handleCommand } from './commands.js';

function createDependencies(input: {
  activationError?: Error;
  settings?: Record<string, string | undefined>;
} = {}) {
  const settingsState = {
    defaultProvider: 'codex',
    ...input.settings,
  };
  const settings = {
    global: vi.fn(() => ({ ...settingsState })),
    updateGlobal: vi.fn((update: Record<string, string | undefined>) => {
      Object.assign(settingsState, update);
    }),
  };
  const activatePrimaryProvider = input.activationError
    ? vi.fn().mockRejectedValue(input.activationError)
    : vi.fn().mockResolvedValue(undefined);

  return {
    conversationService: {
      process: vi.fn().mockResolvedValue({ kind: 'reply', text: 'ok' }),
      resolveDecision: vi.fn().mockResolvedValue({ kind: 'reply', text: 'ok' }),
      launchTask: vi.fn().mockResolvedValue(undefined),
    },
    ownerId: 'owner',
    displayName: 'user',
    projects: {
      listActive: vi.fn().mockReturnValue([]),
      findByName: vi.fn().mockReturnValue(undefined),
    },
    tasks: {
      listActive: vi.fn().mockReturnValue([]),
    },
    providers: {
      list: vi.fn().mockReturnValue(['codex', 'opencode']),
      availability: vi.fn().mockResolvedValue({ available: true }),
    },
    settings,
    activatePrimaryProvider,
  } as never;
}

function captureOutput(repl: Repl): { text(): string } {
  let value = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      value += chunk.toString();
      callback();
    },
  });
  repl.setStreams(process.stdin, output);
  return { text: () => value };
}

describe('terminal command regressions', () => {
  it('prints a successful provider change exactly once', async () => {
    const deps = createDependencies() as any;
    const repl = new Repl(deps);
    const output = captureOutput(repl);

    await repl.processLine('/provider opencode');

    expect(deps.activatePrimaryProvider).toHaveBeenCalledWith('opencode');
    expect(deps.settings.updateGlobal).toHaveBeenCalledWith({ defaultProvider: 'opencode' });
    expect(output.text().match(/Primary provider set to/g)).toHaveLength(1);
  });

  it('does not print provider success after activation failure', async () => {
    const deps = createDependencies({ activationError: new Error('Provider not available') }) as any;
    const repl = new Repl(deps);
    const output = captureOutput(repl);

    await repl.processLine('/provider opencode');

    expect(deps.settings.updateGlobal).not.toHaveBeenCalled();
    expect(output.text()).toContain('Failed to activate opencode');
    expect(output.text()).not.toContain('Primary provider set to');
  });

  it('reports the effective primary model before provider-specific fallbacks', async () => {
    const deps = createDependencies({
      settings: {
        primaryAgentModel: 'effective-model',
        codexModel: 'provider-fallback',
      },
    }) as any;

    const result = await handleCommand('/model', {
      projects: deps.projects,
      tasks: deps.tasks,
      providers: deps.providers,
      settings: deps.settings,
    });

    expect(result?.text).toContain('effective-model');
    expect(result?.text).not.toContain('provider-fallback');
  });
});

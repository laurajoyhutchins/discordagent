import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type AnyThreadChannel } from 'discord.js';
import type {
  AgentEvent,
  ApprovalRequest,
  TaskResult,
  UserQuestion,
} from '../agents/contracts.js';
import type { TaskControlCardRecord, TaskRecord } from '../types.js';
import { DiscordInteractionBroker } from './interactionBroker.js';
import { DiscordTaskRenderer } from './taskRenderer.js';

class FakeSentMessage {
  private static nextId = 0;
  readonly id = `message-${++FakeSentMessage.nextId}`;
  readonly edits: unknown[] = [];
  pinCount = 0;
  componentQueue: Array<FakeButtonInteraction | null> = [];
  content = '';
  failNextEdit = false;
  editFailures = 0;

  constructor(readonly payload: unknown) {
    if (typeof payload === 'string') this.content = payload;
    else if (payload && typeof payload === 'object' && 'content' in payload) {
      this.content = String((payload as { content?: unknown }).content ?? '');
    }
  }

  async edit(payload: unknown) {
    if (this.failNextEdit || this.editFailures > 0) {
      this.failNextEdit = false;
      this.editFailures = Math.max(0, this.editFailures - 1);
      throw new Error('transient Discord edit failure');
    }
    this.edits.push(payload);
    if (typeof payload === 'string') this.content = payload;
    else if (payload && typeof payload === 'object' && 'content' in payload) {
      this.content = String((payload as { content?: unknown }).content ?? '');
    }
    return this;
  }

  async pin() { this.pinCount += 1; return this; }

  async awaitMessageComponent(options?: { time?: number }) {
    const deadline = Date.now() + (options?.time ?? 0);
    do {
      const next = this.componentQueue.shift();
      if (next !== undefined) return next;
      await new Promise(resolve => setTimeout(resolve, 1));
    } while (Date.now() < deadline);
    return null;
  }
}

class FakeButtonInteraction {
  readonly replies: unknown[] = [];
  deferred = false;
  readonly user: { id: string };
  readonly guild: { members: { fetch: () => Promise<{ id: string }> } };

  readonly values: string[];

  constructor(
    readonly customId: string,
    private readonly userId: string,
    values: string[] = [],
  ) {
    this.values = values;
    this.user = { id: userId };
    this.guild = {
      members: {
        fetch: async () => ({ id: userId }),
      },
    };
  }

  async reply(payload: unknown) { this.replies.push(payload); }
  async deferUpdate() { this.deferred = true; }
}

class FakeThread {
  readonly id = 'thread-123456789';
  readonly sent: FakeSentMessage[] = [];
  failNextSend = false;
  messageQueue: Array<{ author: { bot: boolean; id: string }; content: string; guild: FakeButtonInteraction['guild'] } | null> = [];

  async send(payload: unknown) {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('transient Discord send failure');
    }
    const message = new FakeSentMessage(payload);
    this.sent.push(message);
    return message;
  }

  async awaitMessages(options?: { time?: number }) {
    const deadline = Date.now() + (options?.time ?? 0);
    do {
      const next = this.messageQueue.shift();
      if (next !== undefined) {
        return { first: () => next ?? undefined };
      }
      await new Promise(resolve => setTimeout(resolve, 1));
    } while (Date.now() < deadline);
    return { first: () => undefined };
  }
}

function thread(fake: FakeThread): AnyThreadChannel {
  return fake as unknown as AnyThreadChannel;
}

function payloadText(payload: unknown): string {
  return JSON.stringify(payload);
}

describe('DiscordTaskRenderer', () => {
  const task = (status: TaskRecord['status']): TaskRecord => ({
    id: 'task-card-1', projectName: 'factory-floor', provider: 'claude', status,
    channelId: 'agent-1', threadId: 'thread-123456789', objective: 'Implement the feature',
    createdAt: 1, updatedAt: 1,
  });

  it('recovers the card update queue after a failed send so a later update runs', async () => {
    const fake = new FakeThread();
    fake.failNextSend = true;
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0, controlCardCanEmbed: () => false });

    await expect(renderer.start(thread(fake), { task: task('starting') })).rejects.toThrow(/transient Discord send failure/);
    await expect(renderer.updateCard?.({ task: task('running'), phase: 'Retry' })).resolves.toBeUndefined();
    expect(fake.sent).toHaveLength(1);
  });

  it('refetches a stale control card after an edit failure and updates it', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => false,
    });
    await renderer.start(thread(fake), { task: task('starting') });
    fake.sent[0].editFailures = 2;
    await expect(renderer.updateCard?.({ task: task('running') })).rejects.toThrow(/transient Discord edit failure/);
    const fetch = vi.fn(async () => fake.sent[0]);
    (fake as unknown as { messages: { fetch: typeof fetch } }).messages = { fetch };
    await renderer.updateCard?.({ task: task('completed') });

    expect(fetch).toHaveBeenCalledWith(fake.sent[0].id);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].edits).toHaveLength(1);
    expect(cards.get('task-card-1')?.messageId).toBe(fake.sent[0].id);
  });

  it('falls back to a plain-text control-card edit after an embed edit is rejected', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => true,
    });
    await renderer.start(thread(fake), { task: task('starting') });
    fake.sent[0].failNextEdit = true;
    await renderer.updateCard?.({ task: task('running') });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].edits).toHaveLength(1);
    expect(payloadText(fake.sent[0].edits[0])).toContain('State: running');
    expect(cards.get('task-card-1')?.messageId).toBe(fake.sent[0].id);
  });

  it('re-pins a replacement when a persisted pinned card is missing', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>([['task-card-1', {
      taskId: 'task-card-1', messageId: 'missing-card', pinState: 'pinned', updatedAt: 1,
    }]]);
    (fake as unknown as { messages: { fetch: (id: string) => Promise<null> } }).messages = {
      fetch: async id => { expect(id).toBe('missing-card'); return null; },
    };
    const renderer = new DiscordTaskRenderer({
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanPin: () => true,
    });
    await renderer.start(thread(fake), { task: task('running') });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].pinCount).toBe(1);
    expect(cards.get('task-card-1')?.pinState).toBe('pinned');
  });

  it('does not retry a persisted failed pin when replacing a missing card', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>([['task-card-1', {
      taskId: 'task-card-1', messageId: 'failed-card', pinState: 'failed', updatedAt: 1,
    }]]);
    (fake as unknown as { messages: { fetch: (id: string) => Promise<null> } }).messages = {
      fetch: async id => { expect(id).toBe('failed-card'); return null; },
    };
    const renderer = new DiscordTaskRenderer({
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanPin: () => true,
    });
    await renderer.start(thread(fake), { task: task('running') });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].pinCount).toBe(0);
    expect(cards.get('task-card-1')?.pinState).toBe('failed');
  });

  it('rethrows transient control-card fetch failures without sending a duplicate', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>([['task-card-1', {
      taskId: 'task-card-1', messageId: 'existing-card', pinState: 'pinned', updatedAt: 1,
    }]]);
    (fake as unknown as { messages: { fetch: () => Promise<never> } }).messages = {
      fetch: async () => { throw new Error('Discord fetch unavailable'); },
    };
    const renderer = new DiscordTaskRenderer({
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
    });

    await expect(renderer.start(thread(fake), { task: task('running') })).rejects.toThrow(/fetch unavailable/);
    expect(fake.sent).toHaveLength(0);
  });

  it('persists text mode after an embed send failure for later card updates', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const originalSend = fake.send.bind(fake);
    let rejectedEmbed = false;
    fake.send = async (payload: unknown) => {
      if (!rejectedEmbed && payload && typeof payload === 'object' && 'embeds' in payload) {
        rejectedEmbed = true;
        throw new Error('embed unavailable');
      }
      return originalSend(payload);
    };
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => true,
    });
    await renderer.start(thread(fake), { task: task('starting') });
    await renderer.updateCard?.({ task: task('running') });

    expect(fake.sent[0].edits[0]).toMatchObject({ content: expect.stringContaining('State: running') });
  });

  it('disposes its interval idempotently', async () => {
    vi.useFakeTimers();
    try {
      const renderer = new DiscordTaskRenderer({ editIntervalMs: 1000 });
      await renderer.start(thread(new FakeThread()));
      renderer.dispose();
      renderer.dispose();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to plain text when an embed send fails', async () => {
    const fake = new FakeThread();
    const originalSend = fake.send.bind(fake);
    fake.send = async (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'embeds' in payload) throw new Error('embeds unavailable');
      return originalSend(payload);
    };
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    await renderer.start(thread(fake));
    await renderer.handle({ type: 'status', phase: 'Streaming', detail: 'Output continues' });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].content).toContain('Streaming');
    expect(fake.sent[0].content).toContain('Output continues');
  });

  it('falls back to plain text for terminal results when embeds are rejected', async () => {
    const fake = new FakeThread();
    const originalSend = fake.send.bind(fake);
    fake.send = async (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'embeds' in payload) throw new Error('result embeds unavailable');
      return originalSend(payload);
    };
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    await renderer.start(thread(fake));
    await renderer.finish({
      provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 1, completedAt: 2,
      summary: 'Terminal result survived',
    });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].content).toContain('Task complete');
    expect(fake.sent[0].content).toContain('Terminal result survived');
  });

  it('falls back to a persisted plain-text control card when its embed is rejected', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const originalSend = fake.send.bind(fake);
    fake.send = async (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'embeds' in payload) throw new Error('card embeds unavailable');
      return originalSend(payload);
    };
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => true,
    });
    await renderer.start(thread(fake), { task: task('starting') });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].content).toContain('Implement the feature');
    expect(fake.sent[0].content).toContain('State: starting');
    expect(cards.get('task-card-1')?.messageId).toBe(fake.sent[0].id);
  });

  it('creates one durable card, edits it through lifecycle changes, and degrades without pin permission', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const renderer = new DiscordTaskRenderer({
      editIntervalMs: 0,
      controlCardStore: {
        getControlCard: (taskId: string) => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => false,
      controlCardCanPin: () => false,
    });

    await renderer.start(thread(fake), { task: task('starting') });
    await renderer.updateCard?.({ task: task('running'), phase: 'Working' });
    await renderer.updateCard?.({ task: task('completed'), result: {
      provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 1, completedAt: 2,
      summary: 'Done',
    } });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].edits).toHaveLength(2);
    expect(cards.get('task-card-1')).toMatchObject({ pinState: 'not_pinned' });
    expect(payloadText(fake.sent[0].edits.at(-1))).toContain('State: completed');
  });

  it('pins the card once when the effective pin capability is available', async () => {
    const fake = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const renderer = new DiscordTaskRenderer({
      controlCardStore: {
        getControlCard: taskId => cards.get(taskId),
        saveControlCard: (taskId, input) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanPin: () => true,
    });

    await renderer.start(thread(fake), { task: task('starting') });
    await renderer.updateCard?.({ task: task('running') });

    expect(fake.sent[0].pinCount).toBe(1);
    expect(cards.get('task-card-1')?.pinState).toBe('pinned');
  });

  it('coalesces rapid card updates and reloads the persisted message after restart', async () => {
    const first = new FakeThread();
    const cards = new Map<string, TaskControlCardRecord>();
    const options = {
      controlCardStore: {
        getControlCard: (taskId: string) => cards.get(taskId),
        saveControlCard: (taskId: string, input: Omit<TaskControlCardRecord, 'taskId' | 'updatedAt'>) => cards.set(taskId, { taskId, ...input, updatedAt: Date.now() }),
      },
      controlCardCanEmbed: () => false,
      controlCardCanPin: () => false,
    };
    const renderer = new DiscordTaskRenderer(options);
    await renderer.start(thread(first), { task: task('starting') });
    await Promise.all([
      renderer.updateCard?.({ task: task('running'), phase: 'one' }),
      renderer.updateCard?.({ task: task('running'), phase: 'two' }),
      renderer.updateCard?.({ task: task('running'), phase: 'three' }),
    ]);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].edits).toHaveLength(1);

    const second = new FakeThread();
    (second as unknown as { messages: { fetch: (id: string) => Promise<FakeSentMessage> } }).messages = {
      fetch: async id => {
        expect(id).toBe(first.sent[0].id);
        return first.sent[0];
      },
    };
    const restarted = new DiscordTaskRenderer(options);
    await restarted.start(thread(second), { task: task('running') });
    expect(second.sent).toHaveLength(0);
    expect(first.sent[0].edits.at(-1)).toMatchObject({ content: expect.stringContaining('State: running') });
  });

  it('renders every normalized event without provider-specific labels and coalesces text edits', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    renderer.start(thread(fake));

    const events: AgentEvent[] = [
      { type: 'session_started', session: { provider: 'claude', sessionId: 's1', createdAt: 1 } },
      { type: 'text_delta', text: 'Hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'status', phase: 'working', detail: 'Inspecting files' },
      { type: 'plan', items: [{ text: 'Inspect', status: 'completed' }, { text: 'Implement', status: 'in_progress' }] },
      { type: 'command', command: 'npm test', state: 'running', output: 'starting' },
      { type: 'file_change', paths: ['src/index.ts'], summary: 'Updated entry point' },
      {
        type: 'approval_request',
        request: { id: 'a1', kind: 'command', title: 'Run tests', details: 'npm test' },
      },
      { type: 'user_question', question: { id: 'q1', prompt: 'Choose one' } },
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
      {
        type: 'completed',
        result: {
          provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 1, completedAt: 2,
        },
      },
      { type: 'failed', error: { code: 'x', message: 'failed', retryable: false } },
    ];

    for (const event of events) await renderer.handle(event);

    expect(fake.sent[0].content).toContain('Hello world');
    expect(fake.sent[0].edits.length).toBeGreaterThan(0);
    const rendered = fake.sent.map(message => payloadText(message.payload)).join('\n');
    expect(rendered).toContain('Status');
    expect(rendered).toContain('Plan');
    expect(rendered).toContain('Command');
    expect(rendered).toContain('File changes');
    expect(rendered).not.toMatch(/Claude|Codex/);
    expect(rendered).not.toContain('inputTokens');
  });

  it('truncates oversized status details instead of silently dropping the embed', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    renderer.start(thread(fake));

    await renderer.handle({ type: 'status', phase: 'working', detail: 'x'.repeat(8_000) });

    const rendered = payloadText(fake.sent[0].payload);
    expect(rendered.length).toBeLessThan(5_000);
    expect(rendered).toContain('…');
  });

  it('finishes with concise outcome, branch, verification, and unresolved decisions but no routine cost telemetry', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0, notifyUserId: 'user-1' });
    renderer.start(thread(fake));
    await renderer.handle({ type: 'text_delta', text: 'Implemented feature.' });

    const result: TaskResult = {
      provider: 'claude',
      outcome: 'completed',
      exitType: 'success',
      startedAt: 1,
      completedAt: 2,
      summary: 'Worker registry is ready.',
      branchName: 'agent/claude/worker-registry-123456',
      verification: ['npm test: passed', 'npm run build: passed'],
      unresolved: ['Choose persistence backend'],
      costUsd: 9.99,
      usage: { totalTokens: 999999 },
    };
    await renderer.finish(result);

    const finalPayload = fake.sent.at(-1)?.payload;
    const text = payloadText(finalPayload);
    expect(text).toContain('Task complete');
    expect(text).toContain('agent/claude/worker-registry-123456');
    expect(text).toContain('npm test: passed');
    expect(text).toContain('Choose persistence backend');
    expect(text).toContain('<@user-1>');
    expect(text).not.toContain('9.99');
    expect(text).not.toContain('999999');
    expect(text).not.toMatch(/Claude|Codex/);
  });

  it('caps terminal embed fallback text at Discord message size', async () => {
    const fake = new FakeThread();
    fake.failNextSend = true;
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    renderer.start(thread(fake));

    await renderer.finish({
      provider: 'claude', outcome: 'completed', exitType: 'success', startedAt: 1, completedAt: 2,
      summary: 'x'.repeat(8_000),
    });

    expect(fake.sent.at(-1)?.content.length).toBeLessThanOrEqual(2_000);
  });

  it('renders structured terminal failures as an error card instead of raw JSON', async () => {
    const fake = new FakeThread();
    const renderer = new DiscordTaskRenderer({ editIntervalMs: 0 });
    renderer.start(thread(fake));
    const rawError = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: 'The selected model is unavailable.' },
    });

    await renderer.finish({
      provider: 'codex', outcome: 'failed', exitType: 'error', startedAt: 1, completedAt: 2,
      error: { code: 'provider_error', message: rawError, retryable: false },
    });

    const payload = fake.sent.at(-1)?.payload as { embeds: Array<{ toJSON(): Record<string, unknown> }> };
    const embed = payload.embeds[0].toJSON();
    const rendered = JSON.stringify(embed);
    expect(rendered).toContain('The selected model is unavailable.');
    expect(embed.description).not.toContain('{"type":"error"');
    expect(rendered).not.toContain('invalid_request_error\\"');
  });
});

describe('DiscordInteractionBroker', () => {
  const approval: ApprovalRequest = {
    id: 'request-with-a-very-long-identifier-1234567890',
    kind: 'command',
    title: 'Run tests',
    details: 'npm test',
  };

  it('uses task-scoped collision-resistant component IDs and denies approval on timeout', async () => {
    const fake = new FakeThread();
    const broker = new DiscordInteractionBroker({
      isAuthorizedMember: async () => true,
      timeoutMs: 5,
    });

    await expect(broker.requestApproval(thread(fake), approval)).resolves.toBe('timeout');
    const payload = fake.sent[0].payload as { components: Array<{ components: Array<{ data: { custom_id: string } }> }> };
    const ids = payload.components[0].components.map(component => component.data.custom_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^agent:/);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(id).not.toBe('tool_allow');
      expect(id).not.toBe('tool_deny');
    }
  });

  it('collects then verifies authorization and accepts the authorized decision', async () => {
    const fake = new FakeThread();
    const broker = new DiscordInteractionBroker({
      isAuthorizedMember: async member => (member as { id: string }).id === 'authorized',
      timeoutMs: 100,
    });

    const promise = broker.requestApproval(thread(fake), approval);
    await Promise.resolve();
    const payload = fake.sent[0].payload as { components: Array<{ components: Array<{ data: { custom_id: string } }> }> };
    const allowId = payload.components[0].components[0].data.custom_id;
    const unauthorized = new FakeButtonInteraction(allowId, 'intruder');
    const authorized = new FakeButtonInteraction(allowId, 'authorized');
    fake.sent[0].componentQueue.push(unauthorized, authorized);

    await expect(promise).resolves.toBe('allow');
    expect(unauthorized.replies).toEqual([
      expect.objectContaining({ content: 'You are not authorized.', flags: MessageFlags.Ephemeral }),
    ]);
    expect(authorized.deferred).toBe(true);
  });

  it('preserves original select values and disables the menu after an answer', async () => {
    const fake = new FakeThread();
    const broker = new DiscordInteractionBroker({
      isAuthorizedMember: async () => true,
      timeoutMs: 100,
    });
    const originalValue = 'value-'.repeat(30);
    const question: UserQuestion = {
      id: 'question-select',
      prompt: 'Choose one',
      options: Array.from({ length: 6 }, (_, index) => ({
        label: `Option ${index}`,
        value: index === 3 ? originalValue : `value-${index}`,
      })),
    };

    const promise = broker.requestUserInput(thread(fake), question);
    await Promise.resolve();
    const payload = JSON.parse(payloadText(fake.sent[0].payload)) as {
      components: Array<{ components: Array<{ custom_id: string; options: Array<{ value: string }> }> }>;
    };
    const select = payload.components[0].components[0];
    const interaction = new FakeButtonInteraction(select.custom_id, 'authorized', [select.options[3].value]);
    fake.sent[0].componentQueue.push(interaction);

    await expect(promise).resolves.toEqual({ skipped: false, values: [originalValue] });
    expect(payloadText(fake.sent[0].edits.at(-1))).toContain('disabled');
  });

  it('returns an explicit skipped answer when a question times out', async () => {
    const fake = new FakeThread();
    const broker = new DiscordInteractionBroker({
      isAuthorizedMember: async () => true,
      timeoutMs: 5,
    });
    const question: UserQuestion = {
      id: 'question-1',
      prompt: 'Which approach?',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    };

    await expect(broker.requestUserInput(thread(fake), question)).resolves.toEqual({
      skipped: true,
      values: [],
    });
  });
});

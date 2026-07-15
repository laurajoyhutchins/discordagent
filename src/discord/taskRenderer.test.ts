import { describe, expect, it } from 'vitest';
import type { AnyThreadChannel } from 'discord.js';
import type {
  AgentEvent,
  ApprovalRequest,
  TaskResult,
  UserQuestion,
} from '../agents/contracts.js';
import { DiscordInteractionBroker } from './interactionBroker.js';
import { DiscordTaskRenderer } from './taskRenderer.js';

class FakeSentMessage {
  readonly edits: unknown[] = [];
  componentQueue: Array<FakeButtonInteraction | null> = [];
  content = '';

  constructor(readonly payload: unknown) {
    if (typeof payload === 'string') this.content = payload;
    else if (payload && typeof payload === 'object' && 'content' in payload) {
      this.content = String((payload as { content?: unknown }).content ?? '');
    }
  }

  async edit(payload: unknown) {
    this.edits.push(payload);
    if (typeof payload === 'string') this.content = payload;
    else if (payload && typeof payload === 'object' && 'content' in payload) {
      this.content = String((payload as { content?: unknown }).content ?? '');
    }
    return this;
  }

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
  messageQueue: Array<{ author: { bot: boolean; id: string }; content: string; guild: FakeButtonInteraction['guild'] } | null> = [];

  async send(payload: unknown) {
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
      expect.objectContaining({ content: 'You are not authorized.', ephemeral: true }),
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

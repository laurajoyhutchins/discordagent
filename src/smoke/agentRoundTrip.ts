import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import { isStructuredErrorMessage } from '../discord/errorCard.js';

const PROVIDERS = new Set<AgentProviderId>(['claude', 'codex', 'opencode']);
const DEFAULT_PROMPT = 'Reply with a short confirmation that the headless primary-agent smoke test reached you.';
const UNHEALTHY_REPLY_PATTERNS = [
  /^I could not complete the coordination turn:/i,
  /^Codex sign-in is required\b/i,
  /^Codex CLI compatibility error:/i,
  /^I could not form a response\.?$/i,
] as const;

export interface AgentRoundTripOptions {
  readonly provider: AgentProviderId;
  readonly switchProvider?: AgentProviderId;
  readonly prompt: string;
}

export interface AgentRoundTripResult {
  readonly provider: AgentProviderId;
  readonly switchProvider?: AgentProviderId;
  readonly firstKind: string;
  readonly secondKind?: string;
  readonly journalEntries: number;
  readonly responsePreview: string;
}

function providerValue(value: string | undefined, label: string): AgentProviderId | undefined {
  if (!value) return undefined;
  if (!PROVIDERS.has(value as AgentProviderId)) {
    throw new Error(`${label} must be one of: claude, codex, opencode.`);
  }
  return value as AgentProviderId;
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseAgentRoundTripArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): AgentRoundTripOptions {
  const provider = providerValue(valueAfter(args, '--provider') ?? env.HEADLESS_AGENT_PROVIDER?.trim(), '--provider');
  if (!provider) {
    throw new Error('Choose a provider with --provider <claude|codex|opencode> or HEADLESS_AGENT_PROVIDER.');
  }
  const switchProvider = providerValue(valueAfter(args, '--switch-provider'), '--switch-provider');
  if (switchProvider === provider) {
    throw new Error('--switch-provider must differ from --provider.');
  }
  return {
    provider,
    ...(switchProvider ? { switchProvider } : {}),
    prompt: valueAfter(args, '--prompt') ?? DEFAULT_PROMPT,
  };
}

function ensureHeadlessConfig(): void {
  process.env.DISCORD_TOKEN ??= 'headless-agent-smoke';
  process.env.DISCORD_CLIENT_ID ??= 'headless-agent-smoke';
  process.env.DISCORD_GUILD_ID ??= 'headless-agent-smoke';
  process.env.AUTHORIZED_ROLE_IDS ??= 'headless-agent-smoke';
  process.env.AUTHORIZED_USER_ID ??= 'headless-agent-smoke';
  process.env.TERMINAL_REPL_ENABLED = 'false';
}

function headlessClient(): Client {
  return {
    guilds: { cache: new Map() },
    channels: { fetch: async () => null },
  } as unknown as Client;
}

function enabledProviders(options: AgentRoundTripOptions): Set<AgentProviderId> {
  return new Set([options.provider, ...(options.switchProvider ? [options.switchProvider] : [])]);
}

export function assertHealthyAgentResult(
  result: { readonly kind: string; readonly text: string },
  label: string,
): void {
  const text = result.text.trim();
  if (!text) throw new Error(`${label} returned an empty reply.`);
  if (UNHEALTHY_REPLY_PATTERNS.some(pattern => pattern.test(text)) || isStructuredErrorMessage(text)) {
    throw new Error(`${label} provider failed with an unhealthy primary-agent response: ${text.slice(0, 240)}`);
  }
}

export async function runAgentRoundTrip(options: AgentRoundTripOptions): Promise<AgentRoundTripResult> {
  ensureHeadlessConfig();
  const [{ startRuntime, stopRuntime }, { activatePrimaryProvider }] = await Promise.all([
    import('../services/runtime.js'),
    import('../services/agentRuntimeService.js'),
  ]);
  const directory = mkdtempSync(join(tmpdir(), 'discordagent-smoke-'));
  const conversationId = 'smoke:primary';
  const enabled = enabledProviders(options);
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;

  try {
    runtime = await startRuntime(headlessClient(), {
      databasePath: join(directory, 'runtime.sqlite'),
      legacyPath: join(directory, 'missing-projects.json'),
      worktreesBaseDir: join(directory, 'worktrees'),
      headlessPrimaryAgent: true,
      primaryProvider: options.provider,
      disableClaude: !enabled.has('claude'),
      disableCodex: !enabled.has('codex'),
      disableOpenCode: !enabled.has('opencode'),
      disableUsagePolling: true,
    });

    if (options.switchProvider) {
      if (!runtime.providers.list().includes(options.switchProvider)) {
        throw new Error(`${options.switchProvider} is not registered on this host.`);
      }
      const target = runtime.providers.require(options.switchProvider);
      const availability = await target.checkAvailability();
      if (!availability.available) {
        throw new Error(availability.reason ?? `${options.switchProvider} is unavailable on this host.`);
      }
    }

    const first = await runtime.conversationService!.process({
      conversationId,
      userId: 'headless-smoke',
      text: options.prompt,
    });
    assertHealthyAgentResult(first, options.provider);

    let secondKind: string | undefined;
    let responsePreview = first.text.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (options.switchProvider) {
      await activatePrimaryProvider(options.switchProvider);
      const second = await runtime.conversationService!.process({
        conversationId,
        userId: 'headless-smoke',
        text: options.prompt,
      });
      assertHealthyAgentResult(second, options.switchProvider);
      secondKind = second.kind;
      responsePreview = second.text.trim().replace(/\s+/g, ' ').slice(0, 160);
    }

    const journal = runtime.messages.recent(conversationId, 10);
    const expectedEntries = options.switchProvider ? 4 : 2;
    const expectedRoles = options.switchProvider
      ? ['user', 'assistant', 'user', 'assistant']
      : ['user', 'assistant'];
    if (journal.length !== expectedEntries || journal.some((entry, index) => entry.role !== expectedRoles[index])) {
      throw new Error(`Unexpected journal contents: ${journal.map(entry => entry.role).join(', ') || 'empty'}.`);
    }

    return {
      provider: options.provider,
      ...(options.switchProvider ? { switchProvider: options.switchProvider } : {}),
      firstKind: first.kind,
      ...(secondKind ? { secondKind } : {}),
      journalEntries: journal.length,
      responsePreview,
    };
  } finally {
    try {
      if (runtime) await stopRuntime(runtime);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function formatResult(result: AgentRoundTripResult): string {
  const lines = [
    `✓ Primary provider: ${result.provider}`,
    `✓ First conversation turn: ${result.firstKind}`,
  ];
  if (result.switchProvider) {
    lines.push(`✓ Provider reconfiguration: ${result.provider} → ${result.switchProvider}`);
    lines.push(`✓ Second conversation turn: ${result.secondKind}`);
  }
  lines.push(`✓ Durable journal: ${result.journalEntries} entries`);
  lines.push(`✓ Response preview: ${result.responsePreview}`);
  lines.push('', 'READY — headless live-agent plumbing is valid.');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseAgentRoundTripArgs(process.argv.slice(2));
  console.log(formatResult(await runAgentRoundTrip(options)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(`NOT READY — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

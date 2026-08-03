import { maps, table } from './deciduous-projections.mjs';

export function overview(counts, current, unresolved) {
  return `# Discord Agent archaeology

This is the readable projection of the canonical Deciduous SQL graph under [\`.deciduous/graph/\`](../../.deciduous/graph/00-schema.sql). The graph contains **${counts.nodeCount} nodes** and **${counts.edgeCount} typed causal edges**. ${current} nodes are marked as current architecture; ${unresolved} retain unresolved or incomplete evidence.

## Root narratives

### DiscordClaude proved the surface, not the system

Discord was selected because a private server already supplied remote conversation, identity, channels, threads, components, mobile access, and notifications. The original DiscordClaude proof of concept demonstrated remote Claude prompts, streamed tool visibility, thread continuations, approvals, loops, and completion pings. It did not establish provider neutrality, transactional execution state, exact-once gateway delivery, offline verification, or safe crash recovery.

### Provider neutrality required repository-owned runtime contracts

Claude-specific handlers were progressively replaced by normalized provider contracts, SQLite repositories, guarded worktrees, and TaskCoordinator. Codex and OpenCode then joined behind distinct transports while Discord rendering consumed normalized events. Provider neutrality is implemented for the supported adapters, but it does not promise arbitrary-provider portability.

### One primary conversation delegates to focused task contexts

The PM-style primary agent retrieves bounded history, proposes work, collects decisions, and delegates. Provider-specific enforcement removes coding tools from the PM turn. Subagent work appears in threads because threads are focused, visible interaction surfaces. Durable tasks, provider sessions, worktrees, events, and results remain separate. A thread is not an execution.

### Discord projects state without becoming the ledger

For direct Claude, Codex, and OpenCode tasks, TaskCoordinator and SQLite own lifecycle state. Discord handlers and renderers project messages, task cards, components, polls, and notifications. Capability checks and bounded fallbacks address platform constraints, but deterministic tests do not prove every live gateway ordering, reconnect, or rate-limit behavior.

### The REPL exposed the transport boundary

The REPL followed extraction of PrimaryConversationService. It uses \`terminal:primary\`, stdin/stdout, numbered choices, \`/exit\`, and SIGINT-aware shutdown while sharing production memory, providers, coordinator, and usage controls. It is a supported interface and developer harness, not a substitute for live Discord verification.

### Factory Floor became an external authority, not a copied runtime

An early Factory Floor bridge closed unmerged. The corrected boundary assigns Discord identity, launch context, linkage, OAuth/bootstrap, and presentation to Discord Agent, while Factory Floor owns linked runs, attempts, artifacts, approvals, cancellation, receipts, and durable runtime state. Bindings, launch, bootstrap, and revalidation have landed. The rich Activity UI and complete migration away from direct bot-owned execution have not.

## Projections

- [Current architecture](current-architecture.md)
${maps.map(([view, title]) => `- [${title}](${view}.md)`).join('\n')}
- [Unresolved evidence and reliability risks](risks-and-evidence.md)

## Maintenance

1. Reconcile PR or issue claims against merge state, resulting files, current tests, and later corrections.
2. Edit ordered SQL fragments under [\`.deciduous/graph/\`](../../.deciduous/graph/00-schema.sql), preserving stable \`change_id\` values.
3. Run \`npm run deciduous:generate\`.
4. Run \`npm run deciduous:validate\`.
5. Run \`npm run deciduous:check\` before committing.
6. Keep unsupported claims \`unresolved\` or \`incomplete\`.

The fragments populate upstream Deciduous \`decision_nodes\` and \`decision_edges\` directly. Repository-specific lifecycle and evidence live in \`metadata_json\`; the upstream node and edge vocabularies remain unchanged.
`;
}

export function currentArchitecture(graph, counts) {
  const nodes = graph.nodes.filter((node) =>
    node.metadata.views.includes('current-architecture'),
  );
  return `# Current architecture projection

Generated from **${counts.nodeCount} nodes** and **${counts.edgeCount} edges**.

## Confirmed

- Private Discord guild operation with a PM primary channel, project channels, task threads, structured decisions, controls, notifications, and role-scoped interaction.
- Direct TaskCoordinator execution backed by SQLite, guarded worktrees, provider-fixed sessions, normalized events, and Claude, Codex, and OpenCode adapters.
- Repository-owned conversation and memory state with Discord identifiers and provider session identifiers maintained as separate bindings.
- A TTY REPL using \`terminal:primary\`, shared production services, numbered decisions, \`/exit\`, and process-level SIGINT shutdown.
- Main head \`1599c42501e5fa7bd8d10c00dc687910b1055b2e\` passed 817 Vitest tests, 12 script tests, build, typecheck, format/source-policy checks, and 178 documentation links.
- Disabled-by-default Factory Floor bindings, trusted Activity launch, S256 PKCE bootstrap, and fresh principal revalidation are implemented.

## Qualified or incomplete

- Discord remains both a bot transport and a host for the current direct provider runtime.
- Factory Floor is authoritative only for Factory Floor-linked runtime concepts.
- The complete Activity frontend, run and artifact experience, production acceptance, and full migration away from direct bot-owned execution remain incomplete.
- Agent Team composition and mission projection do not prove completed routing or execution migration.
- Live gateway reliability, reconnect behavior, native interaction timing, and rate-limit envelopes remain credentialed verification boundaries.

${table(nodes)}
`;
}

export function risks(graph) {
  const risky = new Set([
    'proof-of-concept',
    'experimental',
    'proposed',
    'incomplete',
    'unresolved',
    'superseded',
    'rejected',
    'abandoned',
    'compatibility-only',
  ]);
  const nodes = graph.nodes.filter((node) => risky.has(node.metada.lifecycle));
  return `# Unresolved evidence and reliability-risk register

## Open evidence

- Default CI does not prove Gateway ordering, duplicate delivery, reconnect behavior, interaction deadlines, production rate limits, or every permission combination.
- Restart recovery restores durable records and avoids automatic replay; it does not prove exactly-once external side effects.
- Activity trust endpoints exist, but the complete client, reusable React views, production acceptance, and full run, artifact, streaming, retry, and cancellation experience remain incomplete.
- Role checks, tool isolation, redaction, and action revalidation do not establish complete protection from prompt injection, malicious attachments, unsafe links, or impersonating quoted content.
- Public documentation and passing CI do not establish hardened production hosting.
- External repositories are referenced only for decisions they own.

## Hostile-review corrections

- Factory Floor authority was narrowed to Factory Floor-linked runs.
- Threads were labeled interaction surfaces, not executions.
- REPL support was separated from live Discord verification.
- Polls were labeled bounded input, not durable approval ledgers.
- Activity trust scaffolding was separated from the incomplete rich console.
- 829 tests were treated as deterministic exact-head evidence, not proof of live gateway reliability.
- Public readiness was separated from production readiness.
- Discord authorization was separated from tool and runtime mutation authority.

${table(nodes)}
`;
}

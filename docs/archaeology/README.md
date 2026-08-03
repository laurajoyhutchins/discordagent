# Discord Agent archaeology

This is the readable projection of the canonical Deciduous SQL graph under [`.deciduous/graph/`](../../.deciduous/graph/00-schema.sql). The graph contains **70 nodes** and **93 typed causal edges**. 40 nodes are marked as current architecture; 9 retain unresolved or incomplete evidence.

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

The REPL followed extraction of PrimaryConversationService. It uses `terminal:primary`, stdin/stdout, numbered choices, `/exit`, and SIGINT-aware shutdown while sharing production memory, providers, coordinator, and usage controls. It is a supported interface and developer harness, not a substitute for live Discord verification.

### Factory Floor became an external authority, not a copied runtime

An early Factory Floor bridge closed unmerged. The corrected boundary assigns Discord identity, launch context, linkage, OAuth/bootstrap, and presentation to Discord Agent, while Factory Floor owns linked runs, attempts, artifacts, approvals, cancellation, receipts, and durable runtime state. Bindings, launch, bootstrap, and revalidation have landed. The rich Activity UI and complete migration away from direct bot-owned execution have not.

## Projections

- [Current architecture](current-architecture.md)
- [Discord transport and interaction model](transport-interaction.md)
- [Conversation identity map](conversation-identity.md)
- [Primary agent and subagent-thread evolution map](primary-subagents.md)
- [REPL evolution map](repl.md)
- [Testing and verification map](testing.md)
- [Factory Floor integration boundary map](factory-floor.md)
- [Authority and security boundary map](authority-security.md)
- [Unresolved evidence and reliability risks](risks-and-evidence.md)

## Maintenance

1. Reconcile PR or issue claims against merge state, resulting files, current tests, and later corrections.
2. Edit ordered SQL fragments under [`.deciduous/graph/`](../../.deciduous/graph/00-schema.sql), preserving stable `change_id` values.
3. Run `npm run deciduous:generate`.
4. Run `npm run deciduous:validate`.
5. Run `npm run deciduous:check` before committing.
6. Keep unsupported claims `unresolved` or `incomplete`.

The fragments populate upstream Deciduous `decision_nodes` and `decision_edges` directly. Repository-specific lifecycle and evidence live in `metadata_json`; the upstream node and edge vocabularies remain unchanged.

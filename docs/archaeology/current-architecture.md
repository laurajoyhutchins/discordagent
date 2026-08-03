# Current architecture projection

Generated from **70 nodes** and **93 edges**.

## Confirmed

- Private Discord guild operation with a PM primary channel, project channels, task threads, structured decisions, controls, notifications, and role-scoped interaction.
- Direct TaskCoordinator execution backed by SQLite, guarded worktrees, provider-fixed sessions, normalized events, and Claude, Codex, and OpenCode adapters.
- Repository-owned conversation and memory state with Discord identifiers and provider session identifiers maintained as separate bindings.
- A TTY REPL using `terminal:primary`, shared production services, numbered decisions, `/exit`, and process-level SIGINT shutdown.
- Main head `1599c42501e5fa7bd8d10c00dc687910b1055b2e` passed 817 Vitest tests, 12 script tests, build, typecheck, format/source-policy checks, and 178 documentation links.
- Disabled-by-default Factory Floor bindings, trusted Activity launch, S256 PKCE bootstrap, and fresh principal revalidation are implemented.

## Qualified or incomplete

- Discord remains both a bot transport and a host for the current direct provider runtime.
- Factory Floor is authoritative only for Factory Floor-linked runtime concepts.
- The complete Activity frontend, run and artifact experience, production acceptance, and full migration away from direct bot-owned execution remain incomplete.
- Agent Team composition and mission projection do not prove completed routing or execution migration.
- Live gateway reliability, reconnect behavior, native interaction timing, and rate-limit envelopes remain credentialed verification boundaries.

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `goal.private-discord-agent-workspace` | goal | active | yes | Operate coding agents from a private Discord workspace |
| `observation.poc-did-not-prove-general-runtime` | observation | active |  | The proof of concept did not establish a general runtime |
| `revisit.claude-specific-coupling` | revisit | active |  | Revisit Claude-specific bot coupling |
| `decision.provider-neutral-contracts` | decision | active | yes | Normalize providers behind agent contracts |
| `action.provider-neutral-foundation` | action | active |  | Build the provider-neutral persistence and rendering foundation |
| `action.add-codex-provider` | action | active |  | Add Codex App Server and PM support |
| `action.add-opencode-provider` | action | active |  | Add OpenCode through ACP |
| `outcome.provider-neutral-but-adapters-specific` | outcome | active | yes | Multi-provider orchestration is implemented, not provider sameness |
| `decision.primary-pm-agent` | decision | active | yes | Keep one persistent primary PM-style agent |
| `decision.primary-tool-isolation` | decision | active | yes | Separate planning authority from coding tools |
| `decision.task-threads-as-interaction-surfaces` | decision | active | yes | Use Discord threads as task interaction surfaces |
| `decision.provider-fixed-task-sessions` | decision | active | yes | Bind each durable task to one provider session |
| `observation.thread-is-not-execution` | observation | active | yes | A Discord thread is not a subagent execution record |
| `decision.discord-operator-interface` | decision | active | yes | Use Discord for conversational operator control |
| `decision.quiet-structured-notifications` | decision | active | yes | Prefer quiet structured status over message volume |
| `outcome.notifications-are-projections` | outcome | active | yes | Notifications remain projections rather than durable receipts |
| `action.capability-aware-delivery` | action | active | yes | Add capability checks and bounded presentation fallbacks |
| `decision.sqlite-durable-state` | decision | active | yes | Own durable direct-runtime state in SQLite |
| `decision.internal-conversation-id` | decision | active | yes | Separate internal conversation identity from Discord message identity |
| `decision.provider-session-separate` | decision | active | yes | Keep provider session identity separate from repository conversation state |
| `action.restart-recovery-without-replay` | action | active | yes | Recover interrupted state without automatic task replay |
| `decision.transport-neutral-primary-conversation` | decision | active | yes | Extract a transport-neutral primary conversation service |
| `action.terminal-repl` | action | active | yes | Add the local terminal REPL adapter |
| `decision.deterministic-offline-tests` | decision | active | yes | Make core behavior verifiable without live Discord |
| `action.headless-agent-smoke` | action | active | yes | Add an opt-in headless live-provider smoke path |
| `outcome.current-deterministic-verification` | outcome | active | yes | Current main passes 829 deterministic tests |
| `decision.taskcoordinator-direct-runtime` | decision | active | yes | Use TaskCoordinator as authority for direct provider tasks |
| `revisit.factory-floor-integration-boundary` | revisit | active |  | Correct the Factory Floor integration boundary |
| `decision.factory-floor-authority` | decision | active | yes | Keep Factory Floor authoritative for Factory Floor-linked runs |
| `decision.discord-agent-activity-adapter` | decision | active | yes | Limit Discord Agent to Activity launch, identity, and linkage |
| `action.factory-floor-bindings-client` | action | active | yes | Add disabled-by-default Factory Floor bindings and clients |
| `action.activity-trusted-launch` | action | experimental |  | Implement trusted Activity launch registration |
| `action.activity-oauth-bootstrap` | action | experimental |  | Implement Activity OAuth and session bootstrap broker |
| `action.activity-principal-revalidation` | action | experimental |  | Implement fresh principal revalidation for sensitive actions |
| `outcome.activity-integration-partial` | outcome | incomplete |  | Activity trust scaffolding exists, but the rich operator console is incomplete |
| `decision.private-guild-role-authorization` | decision | active | yes | Authorize transport access through configured guild and roles |
| `observation.transport-auth-not-tool-authority` | observation | active | yes | Discord transport authorization is not tool authority |
| `action.fresh-principal-revalidation` | action | active | yes | Revalidate Activity principals before sensitive mutations |
| `decision.redaction-and-bounded-output` | decision | active | yes | Centralize redaction and bound Discord-facing output |
| `decision.public-documentation-boundary` | decision | active | yes | Publish architecture and operations without publishing secrets |
| `outcome.public-repository-ready` | outcome | active | yes | The repository is suitable for public source review |
| `observation.activity-console-incomplete` | observation | incomplete |  | Activity trust scaffolding exists before the complete console |
| `action.agent-team-composition-validation` | action | active | yes | Validate effective Agent Team composition |
| `action.mission-lifecycle-projection` | action | active | yes | Persist mission lifecycle and truthful operator projection |
| `decision.direct-runtime-remains-supported` | decision | active | yes | Keep the direct provider runtime supported during migration |
| `revisit.factory-floor-execution-migration` | revisit | proposed |  | Migrate execution authority only after verified parity |
| `observation.cross-repo-authority-is-scoped` | observation | active | yes | Cross-repository authority is scoped, not inherited |
| `outcome.federated-authority-model` | outcome | active | yes | The current architecture is a federated authority model |

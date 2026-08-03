# Unresolved evidence and reliability-risk register

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

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `action.import-discordclaude-poc` | action | proof-of-concept |  | Derive the repository from DiscordClaude |
| `outcome.poc-proved-remote-agent-control` | outcome | proof-of-concept |  | DiscordClaude proved remote conversational control |
| `option.discord-history-as-canonical-state` | option | rejected |  | Use Discord history as the complete conversation store |
| `option.flat-subagent-messages` | option | rejected |  | Represent subagent work as flat channel messages |
| `observation.gateway-exactly-once-unverified` | observation | unresolved |  | Gateway exact-once and in-order delivery remain unproven |
| `observation.restart-is-not-exactly-once` | observation | unresolved |  | Restart recovery is not exact-once execution |
| `observation.live-discord-remains-credentialed` | observation | unresolved |  | Live Discord verification remains credentialed and opt-in |
| `option.run-all-work-in-bot-process` | option | superseded |  | Keep all future execution authority inside the Discord bot |
| `action.factory-floor-bridge-attempt` | action | abandoned |  | Prototype a direct Factory Floor Discord bridge |
| `action.activity-trusted-launch` | action | experimental |  | Implement trusted Activity launch registration |
| `action.activity-oauth-bootstrap` | action | experimental |  | Implement Activity OAuth and session bootstrap broker |
| `action.activity-principal-revalidation` | action | experimental |  | Implement fresh principal revalidation for sensitive actions |
| `outcome.activity-integration-partial` | outcome | incomplete |  | Activity trust scaffolding exists, but the rich operator console is incomplete |
| `option.activity-replaces-chat` | option | rejected |  | Treat the Discord Activity as a replacement for chat |
| `observation.untrusted-content-remains-risk` | observation | unresolved |  | Untrusted content remains a distinct security risk |
| `outcome.public-not-production-ready` | outcome | unresolved |  | Public and tested does not mean production-ready |
| `observation.activity-console-incomplete` | observation | incomplete |  | Activity trust scaffolding exists before the complete console |
| `observation.agent-team-composition-not-routing` | observation | unresolved |  | Validated team composition does not prove routed execution |
| `observation.mission-projection-not-execution` | observation | unresolved |  | Mission projection is not an execution receipt |
| `revisit.factory-floor-execution-migration` | revisit | proposed |  | Migrate execution authority only after verified parity |

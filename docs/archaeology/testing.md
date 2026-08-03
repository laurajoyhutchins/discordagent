# Testing and verification map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["DiscordClaude proved remote conversational control\n[proof-of-concept]"]
  N2["Build the provider-neutral persistence and rendering foundation\n[active]"]
  N3["Add Codex App Server and PM support\n[active]"]
  N4["Add OpenCode through ACP\n[active]"]
  N5["Gateway exact-once and in-order delivery remain unproven\n[unresolved]"]
  N6["A live Discord dependency hindered local debugging and verification\n[active]"]
  N7["Add the local terminal REPL adapter\n[active]"]
  N8["The REPL is supported but not equivalent to live Discord\n[active]"]
  N9["Make core behavior verifiable without live Discord\n[active]"]
  N10["Add an opt-in headless live-provider smoke path\n[active]"]
  N11["Current main passes 829 deterministic tests\n[active]"]
  N12["Live Discord verification remains credentialed and opt-in\n[unresolved]"]
  N13["Add disabled-by-default Factory Floor bindings and clients\n[active]"]
  N14["Untrusted content remains a distinct security risk\n[unresolved]"]
  N15["The repository is suitable for public source review\n[active]"]
  N16["Public and tested does not mean production-ready\n[unresolved]"]
  N17["Persist mission lifecycle and truthful operator projection\n[active]"]
  N18["Mission projection is not an execution receipt\n[unresolved]"]
  N2 -->|leads_to| N3
  N3 -->|leads_to| N4
  N7 -->|leads_to| N8
  N9 -->|leads_to| N10
  N10 -->|leads_to| N11
  N11 -->|leads_to| N12
  N15 -->|leads_to| N16
  N17 -->|leads_to| N18
  N5 -->|leads_to| N6
  N8 -->|leads_to| N9
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `outcome.poc-proved-remote-agent-control` | outcome | proof-of-concept |  | DiscordClaude proved remote conversational control |
| `action.provider-neutral-foundation` | action | active |  | Build the provider-neutral persistence and rendering foundation |
| `action.add-codex-provider` | action | active |  | Add Codex App Server and PM support |
| `action.add-opencode-provider` | action | active |  | Add OpenCode through ACP |
| `observation.gateway-exactly-once-unverified` | observation | unresolved |  | Gateway exact-once and in-order delivery remain unproven |
| `observation.discord-coupling-hindered-development` | observation | active |  | A live Discord dependency hindered local debugging and verification |
| `action.terminal-repl` | action | active | yes | Add the local terminal REPL adapter |
| `outcome.repl-supported-harness-not-discord-equivalent` | outcome | active | yes | The REPL is supported but not equivalent to live Discord |
| `decision.deterministic-offline-tests` | decision | active | yes | Make core behavior verifiable without live Discord |
| `action.headless-agent-smoke` | action | active | yes | Add an opt-in headless live-provider smoke path |
| `outcome.current-deterministic-verification` | outcome | active | yes | Current main passes 829 deterministic tests |
| `observation.live-discord-remains-credentialed` | observation | unresolved |  | Live Discord verification remains credentialed and opt-in |
| `action.factory-floor-bindings-client` | action | active | yes | Add disabled-by-default Factory Floor bindings and clients |
| `observation.untrusted-content-remains-risk` | observation | unresolved |  | Untrusted content remains a distinct security risk |
| `outcome.public-repository-ready` | outcome | active | yes | The repository is suitable for public source review |
| `outcome.public-not-production-ready` | outcome | unresolved |  | Public and tested does not mean production-ready |
| `action.mission-lifecycle-projection` | action | active | yes | Persist mission lifecycle and truthful operator projection |
| `observation.mission-projection-not-execution` | observation | unresolved |  | Mission projection is not an execution receipt |

# Factory Floor integration boundary map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["A Discord thread is not a subagent execution record\n[active]"]
  N2["Discord is unsuitable as authoritative execution state\n[active]"]
  N3["Use TaskCoordinator as authority for direct provider tasks\n[active]"]
  N4["Keep all future execution authority inside the Discord bot\n[superseded]"]
  N5["Prototype a direct Factory Floor Discord bridge\n[abandoned]"]
  N6["Correct the Factory Floor integration boundary\n[active]"]
  N7["Keep Factory Floor authoritative for Factory Floor-linked runs\n[active]"]
  N8["Limit Discord Agent to Activity launch, identity, and linkage\n[active]"]
  N9["Add disabled-by-default Factory Floor bindings and clients\n[active]"]
  N10["Implement trusted Activity launch registration\n[experimental]"]
  N11["Implement Activity OAuth and session bootstrap broker\n[experimental]"]
  N12["Implement fresh principal revalidation for sensitive actions\n[experimental]"]
  N13["Activity trust scaffolding exists, but the rich operator console is incomplete\n[incomplete]"]
  N14["Treat the Discord Activity as a replacement for chat\n[rejected]"]
  N15["Discord transport authorization is not tool authority\n[active]"]
  N16["Revalidate Activity principals before sensitive mutations\n[active]"]
  N17["Activity trust scaffolding exists before the complete console\n[incomplete]"]
  N18["Validate effective Agent Team composition\n[active]"]
  N19["Validated team composition does not prove routed execution\n[unresolved]"]
  N20["Persist mission lifecycle and truthful operator projection\n[active]"]
  N21["Mission projection is not an execution receipt\n[unresolved]"]
  N22["Keep the direct provider runtime supported during migration\n[active]"]
  N23["Migrate execution authority only after verified parity\n[proposed]"]
  N24["Cross-repository authority is scoped, not inherited\n[active]"]
  N25["The current architecture is a federated authority model\n[active]"]
  N3 -->|leads_to| N4
  N5 -->|leads_to| N6
  N6 -->|leads_to| N7
  N7 -->|leads_to| N8
  N8 -->|leads_to| N9
  N9 -->|leads_to| N10
  N10 -->|leads_to| N11
  N11 -->|leads_to| N12
  N12 -->|leads_to| N13
  N13 -->|leads_to| N14
  N15 -->|leads_to| N16
  N18 -->|leads_to| N19
  N20 -->|leads_to| N21
  N22 -->|leads_to| N23
  N24 -->|leads_to| N25
  N4 -->|leads_to| N5
  N17 -->|leads_to| N18
  N19 -->|leads_to| N20
  N21 -->|leads_to| N22
  N23 -->|leads_to| N24
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `observation.thread-is-not-execution` | observation | active | yes | A Discord thread is not a subagent execution record |
| `observation.discord-not-authoritative-runtime` | observation | active | yes | Discord is unsuitable as authoritative execution state |
| `decision.taskcoordinator-direct-runtime` | decision | active | yes | Use TaskCoordinator as authority for direct provider tasks |
| `option.run-all-work-in-bot-process` | option | superseded |  | Keep all future execution authority inside the Discord bot |
| `action.factory-floor-bridge-attempt` | action | abandoned |  | Prototype a direct Factory Floor Discord bridge |
| `revisit.factory-floor-integration-boundary` | revisit | active |  | Correct the Factory Floor integration boundary |
| `decision.factory-floor-authority` | decision | active | yes | Keep Factory Floor authoritative for Factory Floor-linked runs |
| `decision.discord-agent-activity-adapter` | decision | active | yes | Limit Discord Agent to Activity launch, identity, and linkage |
| `action.factory-floor-bindings-client` | action | active | yes | Add disabled-by-default Factory Floor bindings and clients |
| `action.activity-trusted-launch` | action | experimental |  | Implement trusted Activity launch registration |
| `action.activity-oauth-bootstrap` | action | experimental |  | Implement Activity OAuth and session bootstrap broker |
| `action.activity-principal-revalidation` | action | experimental |  | Implement fresh principal revalidation for sensitive actions |
| `outcome.activity-integration-partial` | outcome | incomplete |  | Activity trust scaffolding exists, but the rich operator console is incomplete |
| `option.activity-replaces-chat` | option | rejected |  | Treat the Discord Activity as a replacement for chat |
| `observation.transport-auth-not-tool-authority` | observation | active | yes | Discord transport authorization is not tool authority |
| `action.fresh-principal-revalidation` | action | active | yes | Revalidate Activity principals before sensitive mutations |
| `observation.activity-console-incomplete` | observation | incomplete |  | Activity trust scaffolding exists before the complete console |
| `action.agent-team-composition-validation` | action | active | yes | Validate effective Agent Team composition |
| `observation.agent-team-composition-not-routing` | observation | unresolved |  | Validated team composition does not prove routed execution |
| `action.mission-lifecycle-projection` | action | active | yes | Persist mission lifecycle and truthful operator projection |
| `observation.mission-projection-not-execution` | observation | unresolved |  | Mission projection is not an execution receipt |
| `decision.direct-runtime-remains-supported` | decision | active | yes | Keep the direct provider runtime supported during migration |
| `revisit.factory-floor-execution-migration` | revisit | proposed |  | Migrate execution authority only after verified parity |
| `observation.cross-repo-authority-is-scoped` | observation | active | yes | Cross-repository authority is scoped, not inherited |
| `outcome.federated-authority-model` | outcome | active | yes | The current architecture is a federated authority model |

# Authority and security boundary map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["Keep one persistent primary PM-style agent\n[active]"]
  N2["Separate planning authority from coding tools\n[active]"]
  N3["Polls are useful inputs, not universal approval ledgers\n[active]"]
  N4["Use TaskCoordinator as authority for direct provider tasks\n[active]"]
  N5["Keep Factory Floor authoritative for Factory Floor-linked runs\n[active]"]
  N6["Limit Discord Agent to Activity launch, identity, and linkage\n[active]"]
  N7["Implement trusted Activity launch registration\n[experimental]"]
  N8["Implement Activity OAuth and session bootstrap broker\n[experimental]"]
  N9["Implement fresh principal revalidation for sensitive actions\n[experimental]"]
  N10["Authorize transport access through configured guild and roles\n[active]"]
  N11["Discord transport authorization is not tool authority\n[active]"]
  N12["Revalidate Activity principals before sensitive mutations\n[active]"]
  N13["Centralize redaction and bound Discord-facing output\n[active]"]
  N14["Untrusted content remains a distinct security risk\n[unresolved]"]
  N15["Publish architecture and operations without publishing secrets\n[active]"]
  N16["The repository is suitable for public source review\n[active]"]
  N17["Public and tested does not mean production-ready\n[unresolved]"]
  N18["Validate effective Agent Team composition\n[active]"]
  N19["Validated team composition does not prove routed execution\n[unresolved]"]
  N20["Cross-repository authority is scoped, not inherited\n[active]"]
  N21["The current architecture is a federated authority model\n[active]"]
  N1 -->|leads_to| N2
  N5 -->|leads_to| N6
  N7 -->|leads_to| N8
  N8 -->|leads_to| N9
  N10 -->|leads_to| N11
  N11 -->|leads_to| N12
  N12 -->|leads_to| N13
  N13 -->|leads_to| N14
  N15 -->|leads_to| N16
  N16 -->|leads_to| N17
  N18 -->|leads_to| N19
  N20 -->|leads_to| N21
  N14 -->|leads_to| N15
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `decision.primary-pm-agent` | decision | active | yes | Keep one persistent primary PM-style agent |
| `decision.primary-tool-isolation` | decision | active | yes | Separate planning authority from coding tools |
| `observation.polls-are-not-universal-ledgers` | observation | active |  | Polls are useful inputs, not universal approval ledgers |
| `decision.taskcoordinator-direct-runtime` | decision | active | yes | Use TaskCoordinator as authority for direct provider tasks |
| `decision.factory-floor-authority` | decision | active | yes | Keep Factory Floor authoritative for Factory Floor-linked runs |
| `decision.discord-agent-activity-adapter` | decision | active | yes | Limit Discord Agent to Activity launch, identity, and linkage |
| `action.activity-trusted-launch` | action | experimental |  | Implement trusted Activity launch registration |
| `action.activity-oauth-bootstrap` | action | experimental |  | Implement Activity OAuth and session bootstrap broker |
| `action.activity-principal-revalidation` | action | experimental |  | Implement fresh principal revalidation for sensitive actions |
| `decision.private-guild-role-authorization` | decision | active | yes | Authorize transport access through configured guild and roles |
| `observation.transport-auth-not-tool-authority` | observation | active | yes | Discord transport authorization is not tool authority |
| `action.fresh-principal-revalidation` | action | active | yes | Revalidate Activity principals before sensitive mutations |
| `decision.redaction-and-bounded-output` | decision | active | yes | Centralize redaction and bound Discord-facing output |
| `observation.untrusted-content-remains-risk` | observation | unresolved |  | Untrusted content remains a distinct security risk |
| `decision.public-documentation-boundary` | decision | active | yes | Publish architecture and operations without publishing secrets |
| `outcome.public-repository-ready` | outcome | active | yes | The repository is suitable for public source review |
| `outcome.public-not-production-ready` | outcome | unresolved |  | Public and tested does not mean production-ready |
| `action.agent-team-composition-validation` | action | active | yes | Validate effective Agent Team composition |
| `observation.agent-team-composition-not-routing` | observation | unresolved |  | Validated team composition does not prove routed execution |
| `observation.cross-repo-authority-is-scoped` | observation | active | yes | Cross-repository authority is scoped, not inherited |
| `outcome.federated-authority-model` | outcome | active | yes | The current architecture is a federated authority model |

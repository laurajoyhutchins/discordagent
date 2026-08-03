# Discord transport and interaction model

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["Operate coding agents from a private Discord workspace\n[active]"]
  N2["Choose Discord as the remote interaction surface\n[active]"]
  N3["Derive the repository from DiscordClaude\n[proof-of-concept]"]
  N4["DiscordClaude proved remote conversational control\n[proof-of-concept]"]
  N5["Revisit Claude-specific bot coupling\n[active]"]
  N6["Normalize providers behind agent contracts\n[active]"]
  N7["Represent subagent work as flat channel messages\n[rejected]"]
  N8["Use Discord threads as task interaction surfaces\n[active]"]
  N9["Use Discord for conversational operator control\n[active]"]
  N10["Discord is unsuitable as authoritative execution state\n[active]"]
  N11["Use bounded structured controls for operator decisions\n[active]"]
  N12["Polls are useful inputs, not universal approval ledgers\n[active]"]
  N13["Prefer quiet structured status over message volume\n[active]"]
  N14["Notifications remain projections rather than durable receipts\n[active]"]
  N15["Discord imposes delivery, size, permission, and interaction constraints\n[active]"]
  N16["Add capability checks and bounded presentation fallbacks\n[active]"]
  N17["Treat the Discord Activity as a replacement for chat\n[rejected]"]
  N18["Centralize redaction and bound Discord-facing output\n[active]"]
  N1 -->|leads_to| N2
  N3 -->|leads_to| N4
  N5 -->|leads_to| N6
  N7 -->|leads_to| N8
  N9 -->|leads_to| N10
  N11 -->|leads_to| N12
  N13 -->|leads_to| N14
  N15 -->|leads_to| N16
  N1 -->|enables| N3
  N1 -->|enables| N5
  N1 -->|enables| N9
  N1 -->|enables| N11
  N1 -->|enables| N13
  N1 -->|enables| N15
  N2 -->|leads_to| N3
  N10 -->|leads_to| N11
  N12 -->|leads_to| N13
  N14 -->|leads_to| N15
  N3 -->|enables| N4
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `goal.private-discord-agent-workspace` | goal | active | yes | Operate coding agents from a private Discord workspace |
| `option.discord-conversational-surface` | option | active | yes | Choose Discord as the remote interaction surface |
| `action.import-discordclaude-poc` | action | proof-of-concept |  | Derive the repository from DiscordClaude |
| `outcome.poc-proved-remote-agent-control` | outcome | proof-of-concept |  | DiscordClaude proved remote conversational control |
| `revisit.claude-specific-coupling` | revisit | active |  | Revisit Claude-specific bot coupling |
| `decision.provider-neutral-contracts` | decision | active | yes | Normalize providers behind agent contracts |
| `option.flat-subagent-messages` | option | rejected |  | Represent subagent work as flat channel messages |
| `decision.task-threads-as-interaction-surfaces` | decision | active | yes | Use Discord threads as task interaction surfaces |
| `decision.discord-operator-interface` | decision | active | yes | Use Discord for conversational operator control |
| `observation.discord-not-authoritative-runtime` | observation | active | yes | Discord is unsuitable as authoritative execution state |
| `decision.structured-decisions` | decision | active | yes | Use bounded structured controls for operator decisions |
| `observation.polls-are-not-universal-ledgers` | observation | active |  | Polls are useful inputs, not universal approval ledgers |
| `decision.quiet-structured-notifications` | decision | active | yes | Prefer quiet structured status over message volume |
| `outcome.notifications-are-projections` | outcome | active | yes | Notifications remain projections rather than durable receipts |
| `observation.discord-platform-constraints` | observation | active |  | Discord imposes delivery, size, permission, and interaction constraints |
| `action.capability-aware-delivery` | action | active | yes | Add capability checks and bounded presentation fallbacks |
| `option.activity-replaces-chat` | option | rejected |  | Treat the Discord Activity as a replacement for chat |
| `decision.redaction-and-bounded-output` | decision | active | yes | Centralize redaction and bound Discord-facing output |

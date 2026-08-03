# REPL evolution map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["Use bounded structured controls for operator decisions\n[active]"]
  N2["Polls are useful inputs, not universal approval ledgers\n[active]"]
  N3["Separate internal conversation identity from Discord message identity\n[active]"]
  N4["A live Discord dependency hindered local debugging and verification\n[active]"]
  N5["Extract a transport-neutral primary conversation service\n[active]"]
  N6["Add the local terminal REPL adapter\n[active]"]
  N7["The REPL is supported but not equivalent to live Discord\n[active]"]
  N8["Add an opt-in headless live-provider smoke path\n[active]"]
  N1 -->|leads_to| N2
  N4 -->|leads_to| N5
  N5 -->|leads_to| N6
  N6 -->|leads_to| N7
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `decision.structured-decisions` | decision | active | yes | Use bounded structured controls for operator decisions |
| `observation.polls-are-not-universal-ledgers` | observation | active |  | Polls are useful inputs, not universal approval ledgers |
| `decision.internal-conversation-id` | decision | active | yes | Separate internal conversation identity from Discord message identity |
| `observation.discord-coupling-hindered-development` | observation | active |  | A live Discord dependency hindered local debugging and verification |
| `decision.transport-neutral-primary-conversation` | decision | active | yes | Extract a transport-neutral primary conversation service |
| `action.terminal-repl` | action | active | yes | Add the local terminal REPL adapter |
| `outcome.repl-supported-harness-not-discord-equivalent` | outcome | active | yes | The REPL is supported but not equivalent to live Discord |
| `action.headless-agent-smoke` | action | active | yes | Add an opt-in headless live-provider smoke path |

# Conversation identity map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["Use Discord history as the complete conversation store\n[rejected]"]
  N2["Bind each durable task to one provider session\n[active]"]
  N3["A Discord thread is not a subagent execution record\n[active]"]
  N4["Own durable direct-runtime state in SQLite\n[active]"]
  N5["Separate internal conversation identity from Discord message identity\n[active]"]
  N6["Keep provider session identity separate from repository conversation state\n[active]"]
  N7["Recover interrupted state without automatic task replay\n[active]"]
  N8["Restart recovery is not exact-once execution\n[unresolved]"]
  N9["Extract a transport-neutral primary conversation service\n[active]"]
  N1 -->|leads_to| N4
  N4 -->|leads_to| N5
  N5 -->|leads_to| N6
  N6 -->|leads_to| N7
  N7 -->|leads_to| N8
  N2 -->|leads_to| N3
  N1 -->|enables| N4
  N4 -->|enables| N5
  N5 -->|enables| N6
  N6 -->|enables| N7
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `option.discord-history-as-canonical-state` | option | rejected |  | Use Discord history as the complete conversation store |
| `decision.provider-fixed-task-sessions` | decision | active | yes | Bind each durable task to one provider session |
| `observation.thread-is-not-execution` | observation | active | yes | A Discord thread is not a subagent execution record |
| `decision.sqlite-durable-state` | decision | active | yes | Own durable direct-runtime state in SQLite |
| `decision.internal-conversation-id` | decision | active | yes | Separate internal conversation identity from Discord message identity |
| `decision.provider-session-separate` | decision | active | yes | Keep provider session identity separate from repository conversation state |
| `action.restart-recovery-without-replay` | action | active | yes | Recover interrupted state without automatic task replay |
| `observation.restart-is-not-exactly-once` | observation | unresolved |  | Restart recovery is not exact-once execution |
| `decision.transport-neutral-primary-conversation` | decision | active | yes | Extract a transport-neutral primary conversation service |

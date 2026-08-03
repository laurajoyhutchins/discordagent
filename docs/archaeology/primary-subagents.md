# Primary agent and subagent-thread evolution map

Filtered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.

```mermaid
flowchart TD
  N1["Derive the repository from DiscordClaude\n[proof-of-concept]"]
  N2["Keep one persistent primary PM-style agent\n[active]"]
  N3["Separate planning authority from coding tools\n[active]"]
  N4["Represent subagent work as flat channel messages\n[rejected]"]
  N5["Use Discord threads as task interaction surfaces\n[active]"]
  N6["Bind each durable task to one provider session\n[active]"]
  N7["A Discord thread is not a subagent execution record\n[active]"]
  N8["Make thread deletion an idempotent cleanup signal\n[active]"]
  N9["Use bounded structured controls for operator decisions\n[active]"]
  N10["Keep provider session identity separate from repository conversation state\n[active]"]
  N2 -->|leads_to| N3
  N3 -->|leads_to| N4
  N4 -->|leads_to| N5
  N5 -->|leads_to| N6
  N6 -->|leads_to| N7
  N7 -->|leads_to| N8
```

| Semantic node | Type | Lifecycle | Current | Decision or outcome |
|---|---|---|---:|---|
| `action.import-discordclaude-poc` | action | proof-of-concept |  | Derive the repository from DiscordClaude |
| `decision.primary-pm-agent` | decision | active | yes | Keep one persistent primary PM-style agent |
| `decision.primary-tool-isolation` | decision | active | yes | Separate planning authority from coding tools |
| `option.flat-subagent-messages` | option | rejected |  | Represent subagent work as flat channel messages |
| `decision.task-threads-as-interaction-surfaces` | decision | active | yes | Use Discord threads as task interaction surfaces |
| `decision.provider-fixed-task-sessions` | decision | active | yes | Bind each durable task to one provider session |
| `observation.thread-is-not-execution` | observation | active | yes | A Discord thread is not a subagent execution record |
| `action.thread-delete-cleanup` | action | active |  | Make thread deletion an idempotent cleanup signal |
| `decision.structured-decisions` | decision | active | yes | Use bounded structured controls for operator decisions |
| `decision.provider-session-separate` | decision | active | yes | Keep provider session identity separate from repository conversation state |

# Why Discord Agent

## Motivation

Running coding agents against real repositories typically requires sharing terminal access, managing multiple provider CLIs, and trusting team members with provider credentials. Discord Agent provides a shared, auditable workspace where:

- Team members interact through a familiar Discord interface
- Provider credentials stay on the bot host
- Each task runs in isolation with its own Git branch and worktree
- The PM-style primary agent provides context, planning, and oversight

## Design constraints

### Provider-neutral, not provider-agnostic

The runtime does not abstract away provider differences. Each provider's capabilities, settings, and authentication model are first-class concepts. The contract layer normalizes events and lifecycle, but providers remain individually configurable and independently optional.

### Local-first

Discord Agent runs on the same machine as the repositories it operates on. There is no cloud component, no SaaS tier, and no external orchestration service. The bot host is the trust boundary.

### Private by default

The bot is intended for a private Discord server with trusted users. Public-facing or multi-tenant hosting is not a design goal. All authorization is role-based and owner-gated.

### Durable, not stateless

Task state, provider sessions, conversation history, and memory are persisted in SQLite. Recovery from interruption is manual and deliberate. This avoids silent data loss but requires operator awareness of stateful behavior.

## Comparison to alternatives

| Approach | Discord Agent | Direct CLI | SaaS orchestration |
|---|---|---|---|
| Multi-user | Role-based Discord access | Terminal sharing required | SaaS account management |
| Credential isolation | On host only | On host only | Provider-managed |
| Task isolation | Git worktrees + threads | Manual branch management | Platform-managed |
| Audit trail | SQLite events + Discord threads | Shell history | Platform logs |
| Offline capable | Yes (local SQLite) | Yes | No |
| Provider flexibility | Claude, Codex, OpenCode | Provider-specific | Usually single provider |

## Relationship to DiscordClaude

Discord Agent is derived from [DiscordClaude](https://github.com/NicolaiLolansen/DiscordClaude) and retains the upstream MIT license and attribution. The key architectural evolution is the provider-neutral contract layer, which enables Codex and OpenCode providers alongside Claude without adding provider conditionals to the coordinator, handlers, or renderers.

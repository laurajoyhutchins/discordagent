# Provider support

## Capability matrix

| Capability | Claude | Codex | OpenCode |
|---|---|---|---|
| **Lifecycle** | | | |
| Availability probing | SDK status check | App Server startup + ping | ACP v1 availability probe |
| New task creation | Yes | Yes | Yes |
| Session continuation | Yes | Yes | When ACP advertises capability |
| Cancellation | Yes | Yes | Yes |
| **Execution** | | | |
| Streaming text | Yes | Yes | Yes |
| Plans | Yes | Yes | Yes |
| Commands | Yes | Yes | Yes |
| File changes | Yes | Yes | Yes |
| **Interaction** | | | |
| Approvals | Yes | Yes | Yes (ACP permission requests mapped to Discord) |
| User questions | Yes | Yes | Yes |
| **Primary agent** | | | |
| PM support | Yes (tool-disabled) | Yes (read-only, network-disabled) | Yes (deny-all agent, no tools, disposable workspace) |
| PM model isolation | SDK tool options | App Server read-only turn | Dedicated ACP primary agent config with deny-all permissions |
| **Configuration** | | | |
| Model configuration | Yes | Yes | Yes |
| Reasoning effort | No | Yes (Codex effort) | No |
| Timeout | Yes | No | No |
| MCP profile | Yes | No | No |
| **Usage** | | | |
| Usage reporting | Via SDK callbacks | Rate-limit reads from App Server | ACP usage events |
| Rate-limit awareness | Yes | Yes | Via events |
| **Authentication** | | | |
| Auth method | Local OAuth (host-side) | Device-code login via bot | CLI-native authentication |
| Auth in SQLite | No | No | No |
| Auth in Discord | No | No | No |
| **Provider switch** | | | |
| In-place conversion | Not supported | Not supported | Not supported |
| Sibling handoff | Yes | Yes | Yes |
| **Settings supported** | | | |
| `model` | Yes | Yes | Yes |
| `reasoningEffort` | No | Yes | No |
| `timeoutMs` | Yes | No | No |
| `mcpProfile` | Yes | No | No |

## OpenCode capability-dependent behavior

OpenCode behavior varies based on the ACP version and advertised capabilities:

- **Session load/resume** — only when the ACP transport advertises session continuation
- **ACP permission requests** — mapped to Discord approval components; never automatically approved
- **Filesystem and terminal** — no callbacks supplied; OpenCode has no host I/O access through Discord Agent
- **PM mode** — uses a dedicated ACP primary agent with inline config overriding global permissions to `deny`, all tools disabled, plugins disabled, sharing/snapshots/auto-update off, and a disposable empty workspace

## Model resolution

Model precedence (highest first):

1. One-message `/model <name>` override
2. Provider-scoped project model
3. Provider-specific environment variable (`CLAUDE_MODEL`, `CODEX_MODEL`, `OPENCODE_MODEL`)
4. Provider-native default

## Primary agent model resolution

1. Persisted `primaryAgentModel`
2. Persisted provider-scoped global model
3. Provider-specific host PM setting (`OPENCODE_PRIMARY_MODEL`), then `PRIMARY_AGENT_MODEL`
4. Provider task default environment variable
5. Provider-native default

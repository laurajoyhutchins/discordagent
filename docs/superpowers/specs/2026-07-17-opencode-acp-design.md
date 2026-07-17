# OpenCode ACP Provider Design

**Date:** 2026-07-17

**Status:** Approved design; implementation pending.

## Goal

Add OpenCode as a durable task-thread provider through its local `opencode acp` CLI, while preserving Discord Agent's provider-neutral lifecycle, approval boundary, session persistence, worktree isolation, and redaction rules.

OpenCode is task/project scoped in this release. PM-style `#agent-chat` support is intentionally deferred until a separate restricted primary-model adapter can preserve the PM agent's no-coding-tools contract.

## Context and constraints

The runtime currently exposes a provider-neutral `AgentProvider` contract and registers Claude and Codex implementations from `src/services/runtime.ts`. Providers must normalize all output into `AgentEvent`, persist a provider session before awaiting completion, and use the coordinator for lifecycle ordering. Git worktrees are isolated per task, credentials are not persisted, and consequential approval timeouts deny.

OpenCode provides an ACP-compatible subprocess through `opencode acp`. ACP v1 uses JSON-RPC over stdio, with `initialize`, `session/new`, `session/load`/`session/resume`, `session/prompt`, `session/update`, `session/request_permission`, and `session/cancel` as the relevant lifecycle messages. OpenCode's CLI path and local authentication are host configuration, not Discord-managed credentials.

## Design

### Provider boundary and process lifecycle

Create `src/agents/opencode/` with an `OpenCodeProvider` implementing `AgentProvider` and an ACP client transport built on the official `@agentclientprotocol/sdk` TypeScript package.

The provider launches `opencode acp` with the existing `buildProcessInvocation` helper and `shell: false`. The ACP client must:

1. initialize using ACP v1 and identify itself as Discord Agent;
2. create a new ACP session with the task worktree as an absolute `cwd`;
3. persist the returned ACP session ID through the existing coordinator before awaiting the prompt completion;
4. send the task prompt through `session/prompt`;
5. load or resume a persisted session only when the OpenCode handshake advertises the corresponding capability;
6. send `session/cancel` for cancellation and then close the child process cleanly;
7. reject the provider run if ACP initialization, session creation, or capability negotiation fails.

The provider will not fall back to `opencode run --format json`. A missing/incompatible ACP capability is an availability or provider error, never a silent protocol downgrade.

Each active task run owns its OpenCode ACP subprocess. The persisted session ID remains immutable for the durable task. A process restart marks the task interrupted through existing recovery; no provider turn is replayed automatically.

### Normalized events and decisions

Add a focused OpenCode ACP event adapter. It translates ACP updates as follows:

| ACP signal | Normalized event |
|---|---|
| `agent_message_chunk` | `text_delta` |
| `tool_call` / `tool_call_update` with `execute` | `command` |
| `tool_call` / `tool_call_update` with `edit`, `delete`, or `move` | `file_change` |
| `plan` | `plan` |
| other tool progress | `status` |
| ACP usage metadata, when present | `usage` |
| successful prompt stop | `completed` |
| ACP/process/protocol failure | `failed` |

Permission requests are converted to the existing `ApprovalRequest` contract:

- `execute` maps to `command`;
- `edit`, `delete`, and `move` map to `file_change`;
- all other permission requests map to `tool`.

The adapter sends the request to `AgentRunHost.requestApproval`. The response mapping is least privilege: `allow` selects an ACP `allow_once` option, while `deny` and `timeout` select `reject_once`. The adapter never selects an `allow_always` option automatically.

OpenCode remains responsible for its own built-in file and terminal operations inside the task worktree. The ACP client advertises only capabilities implemented by this integration; it does not expose unimplemented filesystem or terminal callbacks that would create a second execution authority. Unknown ACP update types are ignored or represented as redacted status events rather than causing untrusted payloads to reach Discord or SQLite.

### Runtime, configuration, and provider scope

Extend `AgentProviderId` with `opencode` and add:

- `OPENCODE_CLI_PATH`, default `opencode`;
- `OPENCODE_ENABLED`, default enabled but overridable to `false`;
- `OPENCODE_MODEL`, an optional provider default.

The runtime probes OpenCode's executable and ACP initialization before registering it. If the CLI is missing, ACP cannot initialize, or the process reports an unavailable local authentication state, OpenCode is omitted from the registry with a redacted diagnostic. The first release does not implement a Discord OpenCode login flow; the host operator authenticates with OpenCode locally.

Project channels may select OpenCode with `/provider opencode`, and completed task threads may request OpenCode sibling handoffs. Global PM onboarding and PM provider activation exclude OpenCode until primary-agent support is implemented. The project provider command must explain this scope instead of presenting a provider that cannot activate the PM.

Provider-scoped model settings and `/model` support include OpenCode. When an OpenCode session returns ACP configuration options, the provider applies the requested model through the option categorized as `model` (or the provider's explicit model option ID). If a requested model cannot be applied, the turn fails explicitly; the provider never silently switches to another model. If no model is configured, OpenCode's local default is used.

Usage and inspection displays include OpenCode using provider-neutral labels. OpenCode does not report Codex-style account windows in this release; usage admission uses the existing provider-neutral reservation and observation path without fabricating quota telemetry.

### Error handling and security

- Spawn OpenCode with `shell: false`, using the existing Windows `.cmd` handling.
- Require an absolute worktree `cwd` and never allow a task to run in the source checkout.
- Do not pass Discord tokens, provider credentials, API keys, or device codes into ACP messages or SQLite.
- Redact ACP raw input, raw output, error text, and process stderr before persistence, Discord rendering, or logs.
- Do not enable OpenCode `--auto` approval mode.
- Keep permission requests pending while Discord collects a decision; a short request timeout must not expire during an approval interaction.
- On consequential approval timeout, reject the ACP request and produce the existing timeout behavior.
- On cancellation, resolve or reject pending ACP client callbacks, send `session/cancel`, and terminate the child process without forceful cleanup of the task worktree.
- Preserve a persisted task worktree after startup or provider failure; only an unpersisted clean worktree may be cleaned by existing coordinator rules.
- Reject unsupported ACP protocol versions and missing required baseline capabilities.

### Testing strategy

Use fake ACP stdio processes and protocol fixtures. No OpenCode installation, network access, or real credentials are required for unit tests.

Add tests for:

- JSON-RPC/ACP transport framing, request correlation, notifications, process exit, malformed messages, and redacted errors;
- initialization and capability negotiation;
- new session, load/resume continuation, prompt completion, cancellation, and shutdown;
- text, plan, tool, file-change, usage, completion, unknown-update, and failure normalization;
- allow-once, reject, and timeout permission decisions;
- model config-option selection and explicit unavailable-model failure;
- CLI availability and authentication failures;
- runtime registration, provider-only PM scope, project selection, onboarding, usage display, and handoff behavior;
- Windows command-shim invocation through `buildProcessInvocation`.

Before implementation handoff, run `npm test`, `npm run build`, and `git diff --check`. The branch baseline currently has one unrelated runtime onboarding test failure and must be rechecked after setup; OpenCode work must not hide or weaken that failure.

## Non-goals

- OpenCode PM-style `#agent-chat` support;
- OpenCode's HTTP server mode or SDK/server transport;
- Discord-managed OpenCode authentication;
- automatic provider fallback or automatic model fallback;
- automatic replay of interrupted ACP turns;
- exposing OpenCode filesystem or terminal callbacks that are not implemented by Discord Agent.

## References

- [OpenCode ACP support](https://opencode.ai/docs/acp/)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP tool calls and permissions](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [ACP session configuration options](https://agentclientprotocol.com/protocol/v1/session-config-options)
- [ACP cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)

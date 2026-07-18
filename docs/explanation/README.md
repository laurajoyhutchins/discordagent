# Explanation

Understanding-oriented documentation covering architecture, security, and design rationale.

## Architecture

- [Provider-neutral runtime](architecture/provider-neutral-runtime.md) — runtime topology, task lifecycle, provider contracts, primary agent isolation
- [Primary agent boundary](architecture/primary-agent-boundary.md) — why the PM-style agent has no coding tools
- [Task isolation and Git worktrees](architecture/task-isolation-and-git-worktrees.md) — branch naming, base resolution, safety guarantees
- [Durable state and recovery](architecture/durable-state-and-recovery.md) — SQLite persistence, startup recovery, interrupted task handling
- [Usage admission](architecture/usage-admission.md) — provider windows, calibrated estimates, quiet admission, preserve mode

## Security

- [Trust model](security/trust-model.md) — authorization roles, Discord permissions, host security
- [Authentication boundaries](security/authentication-boundaries.md) — Codex device auth, provider onboarding, credential flow
- [Secret handling and redaction](security/secret-handling-and-redaction.md) — redaction engine, what never reaches SQLite or Discord

## Product

- [Why Discord Agent](product/why-discord-agent.md) — motivation, design constraints, comparison to alternatives

## Decisions

- [Decision records](decisions/README.md) — accepted architectural decisions and their rationale

Explanation pages explain *why* the system behaves as it does. For step-by-step procedures see [how-to guides](../how-to/README.md). For authoritative details see [reference](../reference/README.md).

# How to change a project provider

Change the default provider used for new tasks in a project.

## Prerequisites

- The project is already registered (see [register a project](register-a-project.md))
- The target provider is installed, authenticated, and enabled on the bot host

## Procedure

### Change the project's default provider

In the project's `#agent` channel, run:

```text
/provider codex
```

Or use the settings panel:

```text
/project-settings
```

Select a new default provider. Subsequent tasks in this project will use the new provider.

### Change the global default provider

In `#agent-chat`, run:

```text
/settings
```

Change the **Default provider** setting. New projects will inherit this provider.

### Sibling handoff in a task thread

Changing the provider inside an existing task thread creates a **sibling handoff**, not an in-place session conversion:

```text
/provider claude
```

1. Discord Agent estimates the target input context and shows a confirmation prompt.
2. After confirmation, a new task thread is created with a fresh provider session.
3. The new task gets an isolated branch and worktree based on the committed source branch.
4. A bounded structured summary (not the complete transcript) is transferred to the new provider.

The original task thread, provider session, and worktree remain intact.

## Verification

- Run `/provider` with no arguments in the project channel to see the current provider.
- Run `/list-projects` to confirm the provider for the project.

## Reference

- [Provider support reference](../../reference/provider-support.md)
- [Commands reference: `/provider`](../../reference/commands.md#provider)
- [Sibling handoff explanation](../../explanation/architecture/provider-neutral-runtime.md)

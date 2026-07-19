# Verify agent plumbing without Discord

Use host preflight and the headless live-agent smoke test to verify the runtime without opening a Discord gateway connection.

## Run deterministic host preflight

Start with:

```bash
npm run smoke:host
```

The host reports `READY` when its required Discord configuration, filesystem, Git, and SQLite checks pass and at least one enabled provider executable is available. Other enabled but unavailable providers are warnings rather than host-wide failures. Disable an intentionally absent provider with its `*_ENABLED=false` setting.

Require a particular provider for a deployment or one invocation with:

```bash
REQUIRED_PROVIDERS=codex npm run smoke:host
```

Valid provider IDs are `claude`, `codex`, and `opencode`; multiple IDs are comma-separated. A required provider fails preflight when disabled, unavailable, or reported unauthenticated.

Host preflight does not make a paid model call. Executable probes may not verify authentication, so use the live smoke test below before relying on a provider in production.

## Run one provider round trip

The headless live-agent command uses a temporary SQLite database and worktree directory. It initializes the production provider adapter, primary model, context assembler, conversation service, provider activation boundary, and durable message journal. Temporary state is deleted when the command exits.

Choose a provider that is installed and authenticated on the host:

```bash
npm run smoke:agent -- --provider claude
```

Valid providers are `claude`, `codex`, and `opencode`.

The command can also read the initial provider from an environment variable:

```bash
HEADLESS_AGENT_PROVIDER=codex npm run smoke:agent
```

A successful run reports the conversation result kind, durable journal entry count, and a short response preview, then exits with status 0.

## Verify live provider reconfiguration

Pass a second provider to verify that the shared conversation delegator follows the production provider-activation path:

```bash
npm run smoke:agent -- --provider claude --switch-provider codex
```

Both providers must be installed, authenticated, and available. The command sends one turn through the initial provider, activates the second provider, sends another turn through the same conversation service reference, and verifies four durable journal entries.

## Use a custom prompt

```bash
npm run smoke:agent -- \
  --provider opencode \
  --prompt "Reply with a brief health confirmation."
```

Use a low-cost prompt that should not produce a task proposal or require external tools.

## What the live smoke test verifies

The live smoke test verifies:

- provider discovery and availability;
- construction of the real primary model adapter;
- headless runtime initialization without guild or channel fetches;
- the shared `PrimaryConversationService` delegator;
- context assembly and response parsing;
- durable user and assistant message journaling;
- optional live provider reconfiguration;
- runtime shutdown and temporary-state cleanup.

## What the live smoke test does not verify

The live smoke test does not verify:

- Discord gateway authentication or event delivery;
- guild roles, channel permissions, or command registration;
- Discord message, button, select-menu, poll, or embed rendering;
- delegated task launch, thread creation, or recovery notifications.

Use `npm run smoke:discord` for Discord REST configuration checks. A minimal manual message round trip is still required to verify the gateway and Discord rendering boundary end to end.

## Failure behavior

The live command exits nonzero and prints `NOT READY` when the selected provider is unavailable, authentication is missing, a model turn fails, the response is empty, provider switching fails, or the durable journal does not contain the expected user and assistant entries.

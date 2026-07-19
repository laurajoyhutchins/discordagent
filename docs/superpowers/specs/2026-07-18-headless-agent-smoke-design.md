# Headless Agent Smoke Design

## Goal

Verify the production primary-agent and provider plumbing without requiring a Discord gateway connection or a live guild/channel fetch.

## Architecture

`startRuntime()` gains an explicit headless primary-agent mode. This mode still initializes the durable repositories, provider registry, task coordinator, context assembler, primary model, shared conversation delegator, and provider activation service. It skips Discord primary-channel creation, provider onboarding UI, Discord recovery rendering, and task launching.

The normal Discord startup path remains unchanged unless `headlessPrimaryAgent` is explicitly enabled. A required `primaryProvider` selects the initial provider. An injectable `primaryModelFactory` supports deterministic provider-switch regression tests while production smoke runs use the real provider-specific primary models.

## Smoke command

`src/smoke/agentRoundTrip.ts` creates temporary durable storage, supplies a minimal non-networked Discord client shape, starts the runtime in headless mode, sends a prompt through `PrimaryConversationService`, verifies the response and journal, and shuts down. An optional second provider exercises the existing runtime provider-activation boundary through the same conversation service reference.

## Error handling

Headless startup fails when no primary provider is supplied, the provider is unregistered or unavailable, or no primary model can be constructed. Task launch attempts fail explicitly because Discord project-channel delivery is outside headless scope. The smoke command exits nonzero for provider, model, response, switching, journaling, or cleanup failures.

## Verification boundaries

Covered:

- provider availability and real primary model construction;
- shared conversation delegator activation and reconfiguration;
- context assembly, response parsing, redaction, and durable journaling;
- no guild/channel fetch during headless startup or recovery;
- orderly runtime shutdown.

Not covered:

- Discord gateway event delivery;
- REST guild configuration, roles, commands, or permissions;
- Discord-native rendering and component interaction;
- delegated task launch and thread creation.

## Testing

A runtime regression test starts with injected Claude and Codex providers and provider-specific model factories. It asserts an initial Claude response, reconfiguration to Codex through `activatePrimaryProvider()`, a Codex response through the original conversation service reference, four journal entries, and zero Discord channel fetches.

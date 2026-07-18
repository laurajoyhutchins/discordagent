# Discord Agent documentation

This documentation is organized by reader intent, following the Diátaxis framework.

## Learn with a guided tutorial

New to Discord Agent? Walk through setting up the bot, configuring a provider, and running your first task.

[Run your first agent task](tutorials/run-your-first-agent-task.md)

## Accomplish a specific task

Step-by-step procedures for common operational goals.

- **Discord** — [Create and install the bot](how-to/discord/create-and-install-the-bot.md), [configure permissions and intents](how-to/discord/configure-permissions-and-intents.md), [diagnose Discord connectivity](how-to/discord/diagnose-discord-connectivity.md)
- **Providers** — [Configure Claude](how-to/providers/configure-claude.md), [Codex](how-to/providers/configure-codex.md), [OpenCode](how-to/providers/configure-opencode.md)
- **Projects** — [Register a project](how-to/projects/register-a-project.md), [change a project provider](how-to/projects/change-a-project-provider.md), [remove a project](how-to/projects/remove-a-project.md)
- **Operations** — [Recover an interrupted task](how-to/operations/recover-an-interrupted-task.md), [enable Roborev](how-to/integrations/enable-roborev.md)

[All how-to guides](how-to/README.md)

## Look up exact behavior

Authoritative reference for commands, configuration, provider capabilities, Discord permissions, task states, and compatibility.

- [Commands](reference/commands.md) — slash commands, text commands, authorization, parameters
- [Configuration](reference/configuration.md) — environment variables, defaults, scope
- [Provider support](reference/provider-support.md) — capability matrix per provider
- [Discord capabilities](reference/discord-capabilities.md) — permissions, intents, OAuth, application features
- [Task and project states](reference/task-and-project-states.md) — state values, transitions, persistence
- [Filesystem layout](reference/filesystem-layout.md) — runtime directory structure
- [Compatibility](reference/compatibility.md) — Node, Git, provider CLI versions

[All reference](reference/README.md)

## Understand the design

Architecture, rationale, tradeoffs, and durable design decisions.

- **Architecture** — [Provider-neutral runtime](explanation/architecture/provider-neutral-runtime.md), [primary agent boundary](explanation/architecture/primary-agent-boundary.md), [task isolation and Git worktrees](explanation/architecture/task-isolation-and-git-worktrees.md), [durable state and recovery](explanation/architecture/durable-state-and-recovery.md), [usage admission](explanation/architecture/usage-admission.md), [Factory Floor Activity boundary](explanation/architecture/factory-floor-activity-boundary.md)
- **Security** — [Trust model](explanation/security/trust-model.md), [authentication boundaries](explanation/security/authentication-boundaries.md), [secret handling and redaction](explanation/security/secret-handling-and-redaction.md)
- **Product** — [Why Discord Agent](explanation/product/why-discord-agent.md)

[All explanation](explanation/README.md)

## Contribute

- [Contributing guide](../CONTRIBUTING.md) — for human contributors
- [Development environment](contributing/development-environment.md) — setup, commands, tooling
- [Testing](contributing/testing.md) — testing strategy and patterns
- [Repository structure](contributing/repository-structure.md) — source layout and conventions
- [Release process](contributing/release-process.md) — versioning and publishing

## About Diátaxis

This documentation uses the Diátaxis framework (tutorials, how-to guides, reference, explanation). Each quadrant serves a different reader need:

- **Tutorials** — learning-oriented, guided end-to-end journeys
- **How-to guides** — goal-oriented procedures for specific tasks
- **Reference** — information-oriented, authoritative descriptions
- **Explanation** — understanding-oriented, architectural rationale

When adding documentation, place content in the quadrant that matches the reader's intent. Avoid mixing tutorial steps with reference detail or explanation in how-to guides.

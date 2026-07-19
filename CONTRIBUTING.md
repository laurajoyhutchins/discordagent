# Contributing to Discord Agent

## Repository prerequisites

- Node.js 22 or later
- Git
- npm

## Installation

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
```

## Development commands

```bash
npm test              # Run all tests
npm run build         # Compile TypeScript
npm run check         # Test + build
npm run dev           # Start bot in development mode
npm run register      # Register slash commands in your guild
npm run smoke:host    # Host environment preflight
npm run smoke:discord # Discord connectivity check
```

## Documentation classification

This project uses the Diátaxis documentation framework. When adding documentation:

- **Tutorials** (`docs/tutorials/`) — learning-oriented, guided end-to-end journeys. One clear path.
- **How-to guides** (`docs/how-to/`) — goal-oriented procedures for specific tasks. Assume basic familiarity.
- **Reference** (`docs/reference/`) — information-oriented, authoritative descriptions. Complete and structured.
- **Explanation** (`docs/explanation/`) — understanding-oriented architecture and rationale. Answer *why*.
- **Contributing** (`docs/contributing/`) — developer-oriented setup, testing, and process documentation.

Place content in the quadrant that matches the reader's intent. Do not mix tutorial steps with reference detail. Link between quadrants instead of duplicating.

## GitHub issue workflow

Use GitHub issues for durable work that should remain discoverable beyond one coding session or pull request, including:

- product features and architectural changes;
- reproducible defects and regressions;
- maintenance, operational, and documentation work;
- deferred review findings;
- cross-repository work with explicit dependencies or contract gates.

A small fix discovered and completed entirely inside one focused pull request does not require a separate issue. Do not create placeholder issues without an objective, owned scope, and observable acceptance criteria.

Substantial pull requests should close or reference an issue. Standalone pull requests should explain why the work was small and self-contained enough not to need one.

When implementation reveals follow-up work, capture it before merging instead of leaving it only in review comments, chat history, or a temporary planning document. Cross-repository issues must identify which repository owns each authoritative behavior and must link the corresponding issue or pull request in the other repository.

Issues are planning and coordination records, not a second source of runtime or product truth. Durable architecture belongs in explanation documentation; exact commands and configuration belong in reference documentation; completed behavior belongs in the code and tests.

## Pull request expectations

- Update documentation when changing behavior that users or operators encounter.
- Run `npm test` and `npm run build` before opening or updating a PR.
- Keep PRs focused. Separate documentation PRs from behavioral changes unless they are directly coupled.
- Respect the provider-neutral boundary: do not add provider conditionals to handlers or the coordinator.
- Do not commit secrets, generated SQLite databases, provider credentials, worktrees, or user-specific paths.

## Development guides

- [Development environment](docs/contributing/development-environment.md)
- [Testing guide](docs/contributing/testing.md)
- [Repository structure](docs/contributing/repository-structure.md)
- [Release process](docs/contributing/release-process.md)

## Code of conduct

Be respectful and constructive. This is a small project maintained by volunteers.

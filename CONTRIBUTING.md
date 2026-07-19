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
npm test              # Run deterministic tests without coverage
npm run test:coverage # Run tests and write coverage evidence
npm run typecheck     # Type-check without emitting dist files
npm run lint          # Enforce repository source policies
npm run format:check  # Check tracked text-file formatting hygiene
npm run build         # Compile TypeScript
npm run check         # Type-check, test, and build
npm run check:ci      # Reproduce every deterministic CI check locally
npm run dev           # Start bot in development mode
npm run register      # Register slash commands in your guild
npm run smoke:host    # Host environment preflight
npm run smoke:discord # Discord connectivity check
npm run smoke:agent   # Credentialed provider round trip without Discord
```

Run `npm run check:ci` before opening or updating a substantial pull request. Credentialed smoke commands remain opt-in and are not merge gates because provider availability, quota, and Discord connectivity are external conditions.

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
- Run `npm run check:ci` before opening or updating a substantial PR.
- Add a reproducing regression test for bug fixes.
- Keep PRs focused. Separate documentation PRs from behavioral changes unless they are directly coupled.
- Respect the provider-neutral boundary: do not add provider conditionals to handlers or the coordinator.
- Do not commit secrets, generated SQLite databases, provider credentials, worktrees, or user-specific paths.

GitHub Actions reports independently named **Static quality**, **Tests and coverage**, and **Documentation** jobs. The stable **CI gate** check passes only when all deterministic jobs pass. Superseded runs for the same pull request are cancelled automatically.

## Development guides

- [Development environment](docs/contributing/development-environment.md)
- [Testing guide](docs/contributing/testing.md)
- [Repository structure](docs/contributing/repository-structure.md)
- [Release process](docs/contributing/release-process.md)

## Code of conduct

Be respectful and constructive. This is a small project maintained by volunteers.

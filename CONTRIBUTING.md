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

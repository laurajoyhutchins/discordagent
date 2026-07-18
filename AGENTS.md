# Discord Agent — coding-agent instructions

## Repository purpose

Provider-neutral Discord orchestration runtime for AI coding agents. Run coding agents (Claude, Codex, OpenCode) against local repositories through a private Discord workspace.

## Tech stack

- Node.js 22+, TypeScript ES2022 modules
- discord.js 14, better-sqlite3
- Claude Agent SDK, Codex App Server, OpenCode ACP
- Vitest for testing

## Key commands

```bash
npm ci              # Install locked dependencies
npm test            # Run all tests (Vitest)
npm run build       # TypeScript compile
npm run check       # test + build
npm run dev         # Start bot (tsx)
npm run register    # Register slash commands
```

## Architecture boundaries (do not violate)

1. **Provider-neutral core** — `src/agents/contracts.ts` defines `AgentProvider`, `ProviderSession`, `AgentEvent`, `TaskResult`. Do not import Discord or provider SDK types here.
2. **TaskCoordinator** owns lifecycle ordering. Handlers must not call provider SDKs directly.
3. **Provider isolation** — provider-specific code under `src/agents/<provider>/`. Normalize all output to `AgentEvent`.
4. **No in-place provider switching** — a provider change in a task thread is a sibling handoff, not a session conversion.
5. **Primary agent isolation** — the PM agent has no repository tools and cannot bypass `TaskCoordinator`.

## Documentation placement

Use Diátaxis quadrants (see `docs/README.md`). Write each page in the correct quadrant:
- Tutorials: guided end-to-end journeys
- How-to: operational procedures
- Reference: authoritative descriptions (commands, config, states)
- Explanation: architecture and rationale

Before documenting behavior, inspect the implementation. Do not copy stale README claims without verifying.

## Verification before claiming completion

```bash
npm test
npm run build
git diff --check
```

- Run `npm test` and `npm run build` to confirm they pass.
- Verify all internal relative links in new documentation resolve.
- Do not commit `.env`, SQLite databases, provider credentials, worktrees, or user-specific paths.
- Update `.env.example` if you add or change environment variables.

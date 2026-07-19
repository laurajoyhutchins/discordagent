# Testing

## Test framework

Discord Agent uses [Vitest](https://vitest.dev) with the Node.js environment.

## Running tests

```bash
npm test                 # Run all deterministic tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with complete-source coverage
npm run test:ci          # Run the coverage-gated CI test command
npm run check:ci         # Reproduce every deterministic CI gate locally
```

Credentialed provider and Discord smoke checks are intentionally separate from `check:ci`. They depend on authentication, quota, host tooling, and external service availability, so they provide canary evidence rather than deterministic merge evidence.

## Test configuration

- `environment: 'node'`
- `pool: 'forks'` with `fileParallelism: false` to avoid SQLite database contention
- `restoreMocks: true` and `clearMocks: true` for clean test isolation
- V8 coverage includes every `src/**/*.ts` file and excludes test files
- text, JSON summary, and HTML coverage evidence is retained by GitHub Actions for 14 days

## Coverage ratchet

The initial complete-source baseline measured by CI was:

| Metric | Measured baseline | Required floor |
|---|---:|---:|
| Lines | 70.90% | 70.50% |
| Statements | 67.42% | 67.00% |
| Functions | 68.39% | 68.00% |
| Branches | 61.39% | 61.00% |

The floors are deliberately just below the measured baseline. A pull request must add tests or remove uncovered code before it can reduce a metric below its floor. Raise thresholds when coverage improves materially; do not lower them to make an unrelated change pass.

Coverage is a guardrail, not the sole quality measure. Prioritize recovery behavior, authorization, provider normalization, persistence migrations, cancellation, shutdown, and degraded Discord rendering over low-value line coverage.

## Testing conventions

New behavior follows red-green-refactor. Use:

- **Temporary SQLite files** for repository tests
- **Real temporary Git repositories** for worktree tests
- **Fake providers** for coordinator lifecycle tests
- **Lightweight Discord thread/message fakes** for rendering and handler tests
- **Provider message fixtures** for adapter contract tests

## What to test

| Layer | Approach |
|---|---|
| Domain contracts | Type assertions, fixture-based normalization tests |
| Repositories | Temp SQLite files, CRUD operations, constraint violations |
| Git/worktree | Real temp Git repos, branch/worktree lifecycle |
| Coordinator | Fake providers, lifecycle sequences, recovery scenarios |
| Discord handlers | Fake interactions, message routing, authorization checks |
| Commands | Fake interactions, parameter handling, persistence effects |

Bug fixes must include a test that reproduces the failure before the fix. Changes to durable lifecycle behavior must cover restart recovery, not only the in-memory transition.

## CI feedback targets

Track these targets over a rolling set of pull requests:

- zero merges without the stable `CI gate` succeeding;
- less than 1% rerun-confirmed CI flake rate;
- median time to the first useful failure below 2 minutes;
- p95 deterministic CI duration below 10 minutes;
- 100% of confirmed bug fixes include regression coverage;
- coverage floors never decrease as part of unrelated work.

## Before committing

```bash
npm run check:ci
git diff --check
```

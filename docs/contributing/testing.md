# Testing

## Test framework

Discord Agent uses [Vitest](https://vitest.dev) with the Node.js environment.

## Running tests

```bash
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
```

## Test configuration

- `environment: 'node'`
- `pool: 'forks'` with `fileParallelism: false` to avoid SQLite database contention
- `restoreMocks: true` and `clearMocks: true` for clean test isolation

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

## Before committing

```bash
npm test
npm run build
git diff --check
```

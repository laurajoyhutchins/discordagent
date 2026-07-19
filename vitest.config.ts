import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 70.5,
        statements: 67,
        functions: 68,
        branches: 61,
      },
    },
  },
});

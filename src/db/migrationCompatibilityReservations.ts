import type { Migration } from './migrations.js';

/**
 * Migration version numbers are immutable once released.
 *
 * These slots belonged to schema changes that are no longer part of the
 * application. Keep the versions reserved so an existing database that has
 * already recorded them can never cause a future migration to be skipped.
 */
export const MIGRATION_COMPATIBILITY_RESERVATIONS: readonly Migration[] = [11, 12, 13].map(
  version => ({
    version,
    name: `reserve retired migration slot ${version}`,
    statements: ['SELECT 1'],
  }),
);

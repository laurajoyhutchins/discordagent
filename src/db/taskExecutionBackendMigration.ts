import type { Migration } from './migrations.js';

export const TASK_EXECUTION_BACKEND_MIGRATION: Migration = {
  version: 14,
  name: 'add immutable task execution backend',
  statements: [
    `ALTER TABLE tasks
      ADD COLUMN execution_backend TEXT NOT NULL DEFAULT 'local_provider'
      CHECK (execution_backend IN ('local_provider', 'factory_floor'))`,
  ],
};

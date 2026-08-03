import type { Migration } from './migrations.js';

export const TASK_EXECUTION_BACKEND_MIGRATION: Migration = {
  version: 14,
  name: 'add immutable task execution backend',
  statements: [
    `ALTER TABLE tasks
      ADD COLUMN execution_backend TEXT NOT NULL DEFAULT 'local_provider'
      CHECK (execution_backend IN ('local_provider', 'factory_floor'))`,
    `CREATE TRIGGER tasks_execution_backend_immutable
      BEFORE UPDATE OF execution_backend ON tasks
      FOR EACH ROW
      WHEN NEW.execution_backend <> OLD.execution_backend
      BEGIN
        SELECT RAISE(ABORT, 'task execution backend is immutable');
      END`,
    `CREATE TRIGGER worktrees_require_local_provider_task
      BEFORE INSERT ON worktrees
      FOR EACH ROW
      WHEN (SELECT execution_backend FROM tasks WHERE id = NEW.task_id) <> 'local_provider'
      BEGIN
        SELECT RAISE(ABORT, 'worktrees require a local_provider task');
      END`,
    `CREATE TRIGGER provider_sessions_require_local_provider_task
      BEFORE INSERT ON provider_sessions
      FOR EACH ROW
      WHEN (SELECT execution_backend FROM tasks WHERE id = NEW.task_id) <> 'local_provider'
      BEGIN
        SELECT RAISE(ABORT, 'provider sessions require a local_provider task');
      END`,
  ],
};

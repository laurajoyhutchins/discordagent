import type { DatabaseHandle } from './database.js';
import { SCHEMA_MIGRATIONS } from './schema.js';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

function validateMigrations(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  let previous = 0;

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Migration version must be a positive safe integer: ${migration.version}`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    if (migration.version <= previous) {
      throw new Error('Migrations must be ordered by ascending version');
    }
    if (!migration.name.trim()) {
      throw new Error(`Migration ${migration.version} must have a name`);
    }
    if (migration.statements.length === 0) {
      throw new Error(`Migration ${migration.version} must contain at least one statement`);
    }

    seen.add(migration.version);
    previous = migration.version;
  }
}

export function runMigrations(
  db: DatabaseHandle,
  migrations: readonly Migration[] = SCHEMA_MIGRATIONS,
): void {
  validateMigrations(migrations);
  db.raw.exec(BOOTSTRAP_SQL);

  const hasMigration = db.raw.prepare(
    'SELECT 1 FROM schema_migrations WHERE version = ?',
  );
  const recordMigration = db.raw.prepare(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of migrations) {
    if (hasMigration.get(migration.version)) continue;

    const apply = db.raw.transaction(() => {
      for (const statement of migration.statements) {
        db.raw.exec(statement);
      }
      recordMigration.run(migration.version, migration.name, Date.now());
    });

    apply();
  }
}

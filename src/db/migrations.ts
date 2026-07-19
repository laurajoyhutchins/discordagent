import type { DatabaseHandle } from './database.js';
import { FACTORY_FLOOR_BINDINGS_MIGRATION } from './factoryFloorBindingsMigration.js';
import { SCHEMA_MIGRATIONS } from './schema.js';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
  /**
   * Disable foreign-key enforcement around this migration's transaction.
   *
   * SQLite requires this for table rebuilds that preserve child rows while a
   * referenced table is dropped and recreated. The runner performs an explicit
   * foreign_key_check before committing and restores the prior pragma value.
   */
  disableForeignKeys?: boolean;
}

const DEFAULT_MIGRATIONS: readonly Migration[] = [
  ...SCHEMA_MIGRATIONS,
  FACTORY_FLOOR_BINDINGS_MIGRATION,
];

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

interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

function describeForeignKeyViolations(violations: readonly ForeignKeyViolation[]): string {
  return violations
    .map(item => `${item.table}[${item.rowid ?? 'unknown'}] -> ${item.parent} (fk ${item.fkid})`)
    .join('; ');
}

export function runMigrations(
  db: DatabaseHandle,
  migrations: readonly Migration[] = DEFAULT_MIGRATIONS,
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
      if (migration.disableForeignKeys) {
        const violations = db.raw.pragma('foreign_key_check') as ForeignKeyViolation[];
        if (violations.length > 0) {
          throw new Error(
            `Migration ${migration.version} introduced foreign-key violations: ${describeForeignKeyViolations(violations)}`,
          );
        }
      }
      recordMigration.run(migration.version, migration.name, Date.now());
    });

    if (!migration.disableForeignKeys) {
      apply();
      continue;
    }

    const foreignKeysWereEnabled = Number(db.raw.pragma('foreign_keys', { simple: true })) === 1;
    if (foreignKeysWereEnabled) db.raw.pragma('foreign_keys = OFF');
    try {
      apply();
    } finally {
      if (foreignKeysWereEnabled) db.raw.pragma('foreign_keys = ON');
    }
  }
}

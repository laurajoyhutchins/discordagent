import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveApplicationPaths } from '../utils/applicationPaths.js';

export interface DatabaseHandle {
  readonly raw: Database.Database;
  close(): void;
}

function defaultDatabasePath(): string {
  return resolveApplicationPaths().databasePath;
}

export function openDatabase(path: string = defaultDatabasePath()): DatabaseHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('synchronous = NORMAL');
  if (path !== ':memory:') {
    raw.pragma('journal_mode = WAL');
  }

  let closed = false;
  return {
    raw,
    close(): void {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

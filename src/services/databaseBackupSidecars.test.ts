import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { activateStagedRestore, recoverInterruptedRestore } from "./databaseBackup.js";

const databases: Database.Database[] = [];

function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  databases.push(database);
  return database;
}

function closeDatabase(database: Database.Database): void {
  const index = databases.indexOf(database);
  if (index >= 0) {
    databases.splice(index, 1);
  }
  database.close();
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toThrow();
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("database restore SQLite generation boundaries", () => {
  it("quarantines stale sidecars with the rollback generation and restores them consistently", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-restore-sidecars-"));
    const activePath = join(root, "active.sqlite");
    const stagingPath = join(root, "candidate.sqlite");
    const rollbackPath = join(root, "active.sqlite.rollback");
    const savedWalPath = join(root, "saved-wal");
    const savedShmPath = join(root, "saved-shm");

    const active = openDatabase(activePath);
    active.pragma("journal_mode = WAL");
    active.pragma("wal_autocheckpoint = 0");
    active.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('old generation');
    `);
    active.pragma("wal_checkpoint(TRUNCATE)");
    active.prepare("UPDATE durable_state SET value = ?").run("stale WAL generation");

    await copyFile(`${activePath}-wal`, savedWalPath);
    await copyFile(`${activePath}-shm`, savedShmPath);
    closeDatabase(active);

    // Reproduce an unclean shutdown by restoring the exact WAL/SHM bytes that
    // existed before SQLite's orderly close could checkpoint or delete them.
    await copyFile(savedWalPath, `${activePath}-wal`);
    await copyFile(savedShmPath, `${activePath}-shm`);

    const candidate = openDatabase(stagingPath);
    candidate.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('restored snapshot');
    `);
    closeDatabase(candidate);

    await activateStagedRestore({
      stagingPath,
      activePath,
      rollbackPath,
      expectedSchemaVersion: 6,
      serviceOffline: true,
    });

    const restored = openDatabase(activePath);
    expect(restored.prepare("SELECT value FROM durable_state").get()).toEqual({
      value: "restored snapshot",
    });
    closeDatabase(restored);

    expect((await stat(`${rollbackPath}-wal`)).isFile()).toBe(true);
    expect((await stat(`${rollbackPath}-shm`)).isFile()).toBe(true);
    await expectMissing(`${activePath}-wal`);
    await expectMissing(`${activePath}-shm`);

    // Simulate abandoning the activated candidate after a failed first start.
    // Recovery must restore the complete prior generation, not only its main file.
    await rm(activePath, { force: true });
    await expect(recoverInterruptedRestore({ activePath, rollbackPath })).resolves.toBe(
      "rollback-restored",
    );

    const recovered = openDatabase(activePath);
    expect(recovered.prepare("SELECT value FROM durable_state").get()).toEqual({
      value: "stale WAL generation",
    });
    closeDatabase(recovered);

    await expectMissing(rollbackPath);
    await expectMissing(`${rollbackPath}-wal`);
    await expectMissing(`${rollbackPath}-shm`);
  });
});

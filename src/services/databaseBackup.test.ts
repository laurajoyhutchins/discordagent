import { appendFile, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  activateStagedRestore,
  createOnlineBackup,
  recoverInterruptedRestore,
  RESTORE_CONFIRMATION,
  stageVerifiedRestore,
  verifyBackupArtifact,
} from "./databaseBackup.js";

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

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("database backup", () => {
  it("creates and verifies an online backup from a WAL database", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const sourcePath = join(root, "source.sqlite");
    const database = openDatabase(sourcePath);
    database.pragma("journal_mode = WAL");
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (7);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT NOT NULL);
      INSERT INTO messages (content) VALUES ('before backup');
    `);

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      now: new Date("2026-07-26T02:00:00.000Z"),
      artifactName: "fixture",
    });

    database.prepare("INSERT INTO messages (content) VALUES (?)").run("after backup");

    const verified = await verifyBackupArtifact(artifact.directory);
    expect(verified).toMatchObject({
      applicationVersion: "1.0.0-test",
      schemaVersion: 7,
      sqliteJournalMode: "wal",
      databaseFile: "discordagent.sqlite",
    });

    const restored = openDatabase(artifact.databasePath);
    const rows = restored.prepare("SELECT content FROM messages ORDER BY id").all();
    expect(rows).toEqual([{ content: "before backup" }]);

    expect((await stat(artifact.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(artifact.databasePath)).mode & 0o777).toBe(0o600);
    expect((await stat(artifact.manifestPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects a checksum-mismatched database before opening it", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const database = openDatabase(join(root, "source.sqlite"));
    database.exec("CREATE TABLE durable_state (value TEXT NOT NULL)");
    database.prepare("INSERT INTO durable_state (value) VALUES (?)").run("retained");

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      artifactName: "corrupt",
    });

    await appendFile(artifact.databasePath, Buffer.from([0x00]));

    await expect(verifyBackupArtifact(artifact.directory)).rejects.toThrow(
      "Backup database size does not match manifest",
    );
  });

  it("rejects a manifest schema version that does not match the snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const database = openDatabase(join(root, "source.sqlite"));
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (4);
    `);

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      artifactName: "schema-mismatch",
    });

    const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.schemaVersion = 5;
    await writeFile(artifact.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(verifyBackupArtifact(artifact.directory)).rejects.toThrow(
      "Backup database schema does not match manifest",
    );
  });

  it("rejects a manifest that attempts to escape the artifact directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const database = openDatabase(join(root, "source.sqlite"));
    database.exec("CREATE TABLE durable_state (value TEXT NOT NULL)");

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      artifactName: "escape",
    });

    const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.databaseFile = "../outside.sqlite";
    await writeFile(artifact.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(verifyBackupArtifact(artifact.directory)).rejects.toThrow(
      "Backup manifest database path escapes the artifact directory",
    );
  });

  it("stages a verified restore without modifying the active database", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const activePath = join(root, "active.sqlite");
    const database = openDatabase(activePath);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('backup value');
    `);

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      artifactName: "restore",
    });
    database.prepare("UPDATE durable_state SET value = ?").run("active value");

    const stagingPath = join(root, "restore", "candidate.sqlite");
    const staged = await stageVerifiedRestore({
      artifactDirectory: artifact.directory,
      stagingPath,
      maxSupportedSchemaVersion: 6,
    });

    const stagedDatabase = openDatabase(staged.stagingPath);
    expect(stagedDatabase.prepare("SELECT value FROM durable_state").get()).toEqual({
      value: "backup value",
    });
    expect(database.prepare("SELECT value FROM durable_state").get()).toEqual({
      value: "active value",
    });
    expect((await stat(stagingPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects a future-schema backup before creating restore staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const database = openDatabase(join(root, "source.sqlite"));
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (9);
    `);

    const artifact = await createOnlineBackup({
      database,
      destinationDirectory: join(root, "backups"),
      applicationVersion: "1.0.0-test",
      artifactName: "future",
    });
    const stagingPath = join(root, "restore", "candidate.sqlite");

    await expect(
      stageVerifiedRestore({
        artifactDirectory: artifact.directory,
        stagingPath,
        maxSupportedSchemaVersion: 8,
      }),
    ).rejects.toThrow("Backup schema version 9 exceeds supported version 8");
    await expect(stat(stagingPath)).rejects.toThrow();
  });

  it("requires an offline service or explicit confirmation before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const activePath = join(root, "active.sqlite");
    const stagingPath = join(root, "candidate.sqlite");
    const rollbackPath = join(root, "active.sqlite.rollback");

    const active = openDatabase(activePath);
    active.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('active');
    `);
    const candidate = openDatabase(stagingPath);
    candidate.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('candidate');
    `);
    closeDatabase(active);
    closeDatabase(candidate);

    await expect(
      activateStagedRestore({
        stagingPath,
        activePath,
        rollbackPath,
        expectedSchemaVersion: 6,
      }),
    ).rejects.toThrow(`confirmation ${RESTORE_CONFIRMATION}`);

    const unchanged = openDatabase(activePath);
    expect(unchanged.prepare("SELECT value FROM durable_state").get()).toEqual({ value: "active" });
    expect((await stat(stagingPath)).isFile()).toBe(true);
  });

  it("atomically activates a staged restore and retains the previous database", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const activePath = join(root, "active.sqlite");
    const stagingPath = join(root, "candidate.sqlite");
    const rollbackPath = join(root, "active.sqlite.rollback");

    const active = openDatabase(activePath);
    active.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('active');
    `);
    const candidate = openDatabase(stagingPath);
    candidate.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (6);
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('restored');
    `);
    closeDatabase(active);
    closeDatabase(candidate);

    const activated = await activateStagedRestore({
      stagingPath,
      activePath,
      rollbackPath,
      expectedSchemaVersion: 6,
      serviceOffline: true,
    });

    expect(activated).toEqual({ activePath, rollbackPath });
    const restored = openDatabase(activePath);
    const rollback = openDatabase(rollbackPath);
    expect(restored.prepare("SELECT value FROM durable_state").get()).toEqual({ value: "restored" });
    expect(rollback.prepare("SELECT value FROM durable_state").get()).toEqual({ value: "active" });
    expect((await stat(activePath)).mode & 0o777).toBe(0o600);
    expect((await stat(rollbackPath)).mode & 0o777).toBe(0o600);
  });

  it("recovers the previous database after an interrupted activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-backup-"));
    const activePath = join(root, "active.sqlite");
    const rollbackPath = join(root, "active.sqlite.rollback");
    const active = openDatabase(activePath);
    active.exec(`
      CREATE TABLE durable_state (value TEXT NOT NULL);
      INSERT INTO durable_state (value) VALUES ('previous');
    `);
    closeDatabase(active);
    await rename(activePath, rollbackPath);

    await expect(recoverInterruptedRestore({ activePath, rollbackPath })).resolves.toBe(
      "rollback-restored",
    );
    const recovered = openDatabase(activePath);
    expect(recovered.prepare("SELECT value FROM durable_state").get()).toEqual({
      value: "previous",
    });
    await expect(stat(rollbackPath)).rejects.toThrow();
  });
});

import { appendFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createOnlineBackup, verifyBackupArtifact } from "./databaseBackup.js";

const databases: Database.Database[] = [];

function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  databases.push(database);
  return database;
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
});

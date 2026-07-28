import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createOnlineBackup } from "./databaseBackup.js";
import { pruneBackupArtifacts } from "./databaseBackupRetention.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("backup retention", () => {
  it("deletes only the oldest complete verified artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-retention-"));
    const destinationDirectory = join(root, "backups");
    const database = new Database(join(root, "source.sqlite"));
    database.exec("CREATE TABLE durable_state (value TEXT NOT NULL)");

    const oldest = await createOnlineBackup({
      database,
      destinationDirectory,
      applicationVersion: "1.0.0-test",
      artifactName: "oldest",
      now: new Date("2026-07-24T12:00:00.000Z"),
    });
    const middle = await createOnlineBackup({
      database,
      destinationDirectory,
      applicationVersion: "1.0.0-test",
      artifactName: "middle",
      now: new Date("2026-07-25T12:00:00.000Z"),
    });
    const newest = await createOnlineBackup({
      database,
      destinationDirectory,
      applicationVersion: "1.0.0-test",
      artifactName: "newest",
      now: new Date("2026-07-26T12:00:00.000Z"),
    });
    database.close();

    const result = await pruneBackupArtifacts({ destinationDirectory, keep: 2 });

    expect(result.kept).toEqual([newest.directory, middle.directory]);
    expect(result.deleted).toEqual([oldest.directory]);
    expect(result.skipped).toEqual([]);
    await expect(pathExists(oldest.directory)).resolves.toBe(false);
    await expect(pathExists(middle.directory)).resolves.toBe(true);
    await expect(pathExists(newest.directory)).resolves.toBe(true);
  });

  it("preserves staging and unverifiable directories for investigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "discordagent-retention-"));
    const destinationDirectory = join(root, "backups");
    const database = new Database(join(root, "source.sqlite"));
    database.exec("CREATE TABLE durable_state (value TEXT NOT NULL)");
    const valid = await createOnlineBackup({
      database,
      destinationDirectory,
      applicationVersion: "1.0.0-test",
      artifactName: "valid",
      now: new Date("2026-07-26T12:00:00.000Z"),
    });
    database.close();

    const stagingDirectory = join(destinationDirectory, ".partial.staging");
    await mkdir(stagingDirectory, { mode: 0o700 });
    await writeFile(join(stagingDirectory, "partial"), "incomplete", { mode: 0o600 });

    const corruptDirectory = join(destinationDirectory, "corrupt");
    await mkdir(corruptDirectory, { mode: 0o700 });
    await writeFile(join(corruptDirectory, "manifest.json"), "not-json", { mode: 0o600 });

    const result = await pruneBackupArtifacts({ destinationDirectory, keep: 0 });

    expect(result.kept).toEqual([]);
    expect(result.deleted).toEqual([valid.directory]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { directory: stagingDirectory, reason: "staging-directory" },
        expect.objectContaining({ directory: corruptDirectory }),
      ]),
    );
    await expect(pathExists(valid.directory)).resolves.toBe(false);
    await expect(pathExists(stagingDirectory)).resolves.toBe(true);
    await expect(pathExists(corruptDirectory)).resolves.toBe(true);
  });

  it("rejects invalid retention counts before scanning", async () => {
    await expect(
      pruneBackupArtifacts({ destinationDirectory: "/unused", keep: -1 }),
    ).rejects.toThrow("Backup retention count must be a non-negative integer");
  });
});

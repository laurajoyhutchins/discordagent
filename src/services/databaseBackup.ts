import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

const ARTIFACT_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MANIFEST_VERSION = 1;

export interface BackupManifest {
  manifestVersion: 1;
  applicationVersion: string;
  schemaVersion: number;
  createdAt: string;
  databaseFile: string;
  databaseSha256: string;
  databaseBytes: number;
  sqliteJournalMode: string;
}

export interface CreateOnlineBackupOptions {
  database: Database.Database;
  destinationDirectory: string;
  applicationVersion: string;
  now?: Date;
  artifactName?: string;
}

export interface BackupArtifact {
  directory: string;
  databasePath: string;
  manifestPath: string;
  manifest: BackupManifest;
}

export interface StageVerifiedRestoreOptions {
  artifactDirectory: string;
  stagingPath: string;
  maxSupportedSchemaVersion: number;
}

export interface StagedRestore {
  stagingPath: string;
  manifest: BackupManifest;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function readSchemaVersion(database: Database.Database): number {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name?: string } | undefined;

  if (!table?.name) {
    return 0;
  }

  const row = database
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null };

  return row.version ?? 0;
}

function readJournalMode(database: Database.Database): string {
  const row = database.pragma("journal_mode", { simple: true });
  return String(row).toLowerCase();
}

function assertSafeArtifactName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new Error(`Unsafe backup artifact name: ${name}`);
  }
}

function resolveBackupDatabasePath(directory: string, manifest: BackupManifest): string {
  const artifactDirectory = resolve(directory);
  if (basename(manifest.databaseFile) !== manifest.databaseFile) {
    throw new Error("Backup manifest database path escapes the artifact directory");
  }

  const databasePath = join(artifactDirectory, manifest.databaseFile);
  if (dirname(databasePath) !== artifactDirectory) {
    throw new Error("Backup database path escapes the artifact directory");
  }
  return databasePath;
}

export async function createOnlineBackup(
  options: CreateOnlineBackupOptions,
): Promise<BackupArtifact> {
  const now = options.now ?? new Date();
  const artifactName =
    options.artifactName ?? `discordagent-${now.toISOString().replaceAll(":", "-")}`;
  assertSafeArtifactName(artifactName);

  const destinationRoot = resolve(options.destinationDirectory);
  const finalDirectory = join(destinationRoot, artifactName);
  const stagingDirectory = join(destinationRoot, `.${artifactName}.staging`);
  const databaseFile = "discordagent.sqlite";
  const databasePath = join(stagingDirectory, databaseFile);
  const manifestPath = join(stagingDirectory, "manifest.json");

  await mkdir(destinationRoot, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(destinationRoot, DIRECTORY_MODE);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { mode: DIRECTORY_MODE });

  try {
    await options.database.backup(databasePath);
    await chmod(databasePath, ARTIFACT_MODE);

    const backup = new Database(databasePath, { readonly: true, fileMustExist: true });
    let schemaVersion: number;
    try {
      const quickCheck = backup.pragma("quick_check", { simple: true });
      if (quickCheck !== "ok") {
        throw new Error(`SQLite backup integrity check failed: ${String(quickCheck)}`);
      }
      schemaVersion = readSchemaVersion(backup);
    } finally {
      backup.close();
    }

    const databaseContent = await readFile(databasePath);
    const manifest: BackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      applicationVersion: options.applicationVersion,
      schemaVersion,
      createdAt: now.toISOString(),
      databaseFile,
      databaseSha256: sha256(databaseContent),
      databaseBytes: databaseContent.byteLength,
      sqliteJournalMode: readJournalMode(options.database),
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: ARTIFACT_MODE,
      flag: "wx",
    });
    await chmod(manifestPath, ARTIFACT_MODE);

    await verifyBackupArtifact(stagingDirectory);
    await rename(stagingDirectory, finalDirectory);

    return {
      directory: finalDirectory,
      databasePath: join(finalDirectory, databaseFile),
      manifestPath: join(finalDirectory, "manifest.json"),
      manifest,
    };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackupArtifact(directory: string): Promise<BackupManifest> {
  const artifactDirectory = resolve(directory);
  const manifestPath = join(artifactDirectory, "manifest.json");
  const rawManifest = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(rawManifest) as Partial<BackupManifest>;

  if (
    manifest.manifestVersion !== MANIFEST_VERSION ||
    typeof manifest.applicationVersion !== "string" ||
    !Number.isInteger(manifest.schemaVersion) ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.databaseFile !== "string" ||
    typeof manifest.databaseSha256 !== "string" ||
    !Number.isInteger(manifest.databaseBytes) ||
    typeof manifest.sqliteJournalMode !== "string"
  ) {
    throw new Error("Backup manifest is invalid or unsupported");
  }

  const verifiedManifest = manifest as BackupManifest;
  const databasePath = resolveBackupDatabasePath(artifactDirectory, verifiedManifest);
  const databaseContent = await readFile(databasePath);
  if (databaseContent.byteLength !== verifiedManifest.databaseBytes) {
    throw new Error("Backup database size does not match manifest");
  }
  if (sha256(databaseContent) !== verifiedManifest.databaseSha256) {
    throw new Error("Backup database checksum does not match manifest");
  }

  const backup = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = backup.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      throw new Error(`SQLite backup integrity check failed: ${String(quickCheck)}`);
    }
    if (readSchemaVersion(backup) !== verifiedManifest.schemaVersion) {
      throw new Error("Backup database schema does not match manifest");
    }
  } finally {
    backup.close();
  }

  return verifiedManifest;
}

export async function stageVerifiedRestore(
  options: StageVerifiedRestoreOptions,
): Promise<StagedRestore> {
  if (!Number.isInteger(options.maxSupportedSchemaVersion) || options.maxSupportedSchemaVersion < 0) {
    throw new Error("Maximum supported schema version must be a non-negative integer");
  }

  const manifest = await verifyBackupArtifact(options.artifactDirectory);
  if (manifest.schemaVersion > options.maxSupportedSchemaVersion) {
    throw new Error(
      `Backup schema version ${manifest.schemaVersion} exceeds supported version ${options.maxSupportedSchemaVersion}`,
    );
  }

  const sourcePath = resolveBackupDatabasePath(options.artifactDirectory, manifest);
  const stagingPath = resolve(options.stagingPath);
  await mkdir(dirname(stagingPath), { recursive: true, mode: DIRECTORY_MODE });
  await rm(stagingPath, { force: true });
  await copyFile(sourcePath, stagingPath);
  await chmod(stagingPath, ARTIFACT_MODE);

  try {
    const staged = new Database(stagingPath, { readonly: true, fileMustExist: true });
    try {
      const quickCheck = staged.pragma("quick_check", { simple: true });
      if (quickCheck !== "ok") {
        throw new Error(`Staged restore integrity check failed: ${String(quickCheck)}`);
      }
      if (readSchemaVersion(staged) !== manifest.schemaVersion) {
        throw new Error("Staged restore schema does not match manifest");
      }
    } finally {
      staged.close();
    }
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }

  return { stagingPath, manifest };
}

import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

const ARTIFACT_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MANIFEST_VERSION = 1;
export const RESTORE_CONFIRMATION = "RESTORE_DISCORD_AGENT";

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

export interface ActivateStagedRestoreOptions {
  stagingPath: string;
  activePath: string;
  rollbackPath: string;
  expectedSchemaVersion: number;
  serviceOffline?: boolean;
  confirmation?: string;
}

export interface ActivatedRestore {
  activePath: string;
  rollbackPath: string | null;
}

export interface RecoverInterruptedRestoreOptions {
  activePath: string;
  rollbackPath: string;
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

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertDistinctPaths(paths: Record<string, string>): void {
  const entries = Object.entries(paths).map(([label, path]) => [label, resolve(path)] as const);
  for (let index = 0; index < entries.length; index += 1) {
    for (let comparison = index + 1; comparison < entries.length; comparison += 1) {
      if (entries[index][1] === entries[comparison][1]) {
        throw new Error(`${entries[index][0]} and ${entries[comparison][0]} must be different paths`);
      }
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateDatabaseFile(path: string, expectedSchemaVersion: number, label: string): void {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = database.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      throw new Error(`${label} integrity check failed: ${String(quickCheck)}`);
    }
    if (readSchemaVersion(database) !== expectedSchemaVersion) {
      throw new Error(`${label} schema does not match expected version ${expectedSchemaVersion}`);
    }
  } finally {
    database.close();
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
  assertNonNegativeInteger(options.maxSupportedSchemaVersion, "Maximum supported schema version");

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
    validateDatabaseFile(stagingPath, manifest.schemaVersion, "Staged restore");
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }

  return { stagingPath, manifest };
}

export async function recoverInterruptedRestore(
  options: RecoverInterruptedRestoreOptions,
): Promise<"active-present" | "rollback-restored" | "no-database"> {
  const activePath = resolve(options.activePath);
  const rollbackPath = resolve(options.rollbackPath);
  assertDistinctPaths({ activePath, rollbackPath });

  if (await pathExists(activePath)) {
    return "active-present";
  }
  if (!(await pathExists(rollbackPath))) {
    return "no-database";
  }

  await mkdir(dirname(activePath), { recursive: true, mode: DIRECTORY_MODE });
  await rename(rollbackPath, activePath);
  await chmod(activePath, ARTIFACT_MODE);
  return "rollback-restored";
}

export async function activateStagedRestore(
  options: ActivateStagedRestoreOptions,
): Promise<ActivatedRestore> {
  assertNonNegativeInteger(options.expectedSchemaVersion, "Expected schema version");
  if (!options.serviceOffline && options.confirmation !== RESTORE_CONFIRMATION) {
    throw new Error(
      `Destructive restore requires an offline service or confirmation ${RESTORE_CONFIRMATION}`,
    );
  }

  const stagingPath = resolve(options.stagingPath);
  const activePath = resolve(options.activePath);
  const rollbackPath = resolve(options.rollbackPath);
  assertDistinctPaths({ stagingPath, activePath, rollbackPath });

  validateDatabaseFile(stagingPath, options.expectedSchemaVersion, "Staged restore");
  await recoverInterruptedRestore({ activePath, rollbackPath });
  await mkdir(dirname(activePath), { recursive: true, mode: DIRECTORY_MODE });

  const hadActiveDatabase = await pathExists(activePath);
  if (hadActiveDatabase) {
    await rm(rollbackPath, { force: true });
    await rename(activePath, rollbackPath);
    await chmod(rollbackPath, ARTIFACT_MODE);
  }

  try {
    await rename(stagingPath, activePath);
    await chmod(activePath, ARTIFACT_MODE);
    validateDatabaseFile(activePath, options.expectedSchemaVersion, "Activated restore");
  } catch (error) {
    await rm(activePath, { force: true });
    if (hadActiveDatabase && (await pathExists(rollbackPath))) {
      await rename(rollbackPath, activePath);
      await chmod(activePath, ARTIFACT_MODE);
    }
    throw error;
  }

  return {
    activePath,
    rollbackPath: hadActiveDatabase ? rollbackPath : null,
  };
}

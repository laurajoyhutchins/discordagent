import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { verifyBackupArtifact } from "./databaseBackup.js";

export interface PruneBackupArtifactsOptions {
  destinationDirectory: string;
  keep: number;
}

export interface PruneBackupArtifactsResult {
  kept: string[];
  deleted: string[];
  skipped: Array<{ directory: string; reason: string }>;
}

interface VerifiedArtifact {
  directory: string;
  createdAt: string;
  createdAtEpoch: number;
}

function assertRetentionCount(keep: number): void {
  if (!Number.isInteger(keep) || keep < 0) {
    throw new Error("Backup retention count must be a non-negative integer");
  }
}

export async function pruneBackupArtifacts(
  options: PruneBackupArtifactsOptions,
): Promise<PruneBackupArtifactsResult> {
  assertRetentionCount(options.keep);

  const destinationDirectory = resolve(options.destinationDirectory);
  const entries = await readdir(destinationDirectory, { withFileTypes: true });
  const verified: VerifiedArtifact[] = [];
  const skipped: Array<{ directory: string; reason: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const directory = join(destinationDirectory, entry.name);
    if (entry.name.startsWith(".") && entry.name.endsWith(".staging")) {
      skipped.push({ directory, reason: "staging-directory" });
      continue;
    }

    try {
      const manifest = await verifyBackupArtifact(directory);
      const createdAtEpoch = Date.parse(manifest.createdAt);
      if (!Number.isFinite(createdAtEpoch)) {
        skipped.push({ directory, reason: "invalid-created-at" });
        continue;
      }
      verified.push({ directory, createdAt: manifest.createdAt, createdAtEpoch });
    } catch (error) {
      skipped.push({
        directory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  verified.sort(
    (left, right) =>
      right.createdAtEpoch - left.createdAtEpoch ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.directory.localeCompare(left.directory),
  );

  const kept = verified.slice(0, options.keep).map(artifact => artifact.directory);
  const deletable = verified.slice(options.keep);
  const deleted: string[] = [];

  for (const artifact of deletable) {
    await rm(artifact.directory, { recursive: true, force: false });
    deleted.push(artifact.directory);
  }

  return { kept, deleted, skipped };
}

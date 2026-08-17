import 'dotenv/config';
import { statfsSync } from 'node:fs';
import { freemem } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveApplicationPaths } from '../utils/applicationPaths.js';

export interface ResourceSnapshot {
  readonly freeDiskMb: number;
  readonly freeMemoryMb: number;
}

export interface ResourceAdmissionResult {
  readonly ready: boolean;
  readonly checks: readonly string[];
}

function positiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number.`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = positiveNumber(env, key, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

export function captureResourceSnapshot(env: NodeJS.ProcessEnv = process.env): ResourceSnapshot {
  const { dataRoot } = resolveApplicationPaths({ env });
  const disk = statfsSync(dataRoot);
  return {
    freeDiskMb: Number(disk.bavail * disk.bsize) / (1024 * 1024),
    freeMemoryMb: freemem() / (1024 * 1024),
  };
}

export function evaluateResourceAdmission(
  env: NodeJS.ProcessEnv,
  snapshot: ResourceSnapshot,
): ResourceAdmissionResult {
  const minDiskMb = positiveNumber(env, 'MIN_FREE_DISK_MB', 2048);
  const minMemoryMb = positiveNumber(env, 'MIN_FREE_MEMORY_MB', 256);
  const maxConcurrentTasks = positiveInteger(env, 'MAX_CONCURRENT_TASKS', 1);
  const checks: string[] = [];
  let ready = true;

  if (snapshot.freeDiskMb < minDiskMb) {
    ready = false;
    checks.push(`FAIL disk: ${snapshot.freeDiskMb.toFixed(0)} MB free; ${minDiskMb} MB required.`);
  } else {
    checks.push(`PASS disk: ${snapshot.freeDiskMb.toFixed(0)} MB free; ${minDiskMb} MB required.`);
  }

  if (snapshot.freeMemoryMb < minMemoryMb) {
    ready = false;
    checks.push(`FAIL memory: ${snapshot.freeMemoryMb.toFixed(0)} MB free; ${minMemoryMb} MB required.`);
  } else {
    checks.push(`PASS memory: ${snapshot.freeMemoryMb.toFixed(0)} MB free; ${minMemoryMb} MB required.`);
  }

  checks.push(`PASS concurrency: MAX_CONCURRENT_TASKS=${maxConcurrentTasks}.`);
  return { ready, checks };
}

function main(): void {
  try {
    const result = evaluateResourceAdmission(process.env, captureResourceSnapshot());
    console.log(result.checks.join('\n'));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

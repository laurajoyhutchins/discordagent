import { createServer, type Server } from 'node:net';

import Database from 'better-sqlite3';

import { resolveApplicationPaths } from '../utils/applicationPaths.js';
import {
  activateStagedRestore,
  createOnlineBackup,
  stageVerifiedRestore,
  verifyBackupArtifact,
} from '../services/databaseBackup.js';

const INSTANCE_LOCK_HOST = '127.0.0.1';
const DEFAULT_INSTANCE_LOCK_PORT = 47831;

function requiredArgument(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

function parseNonNegativeInteger(value: string | undefined, name: string): number {
  const parsed = Number(requiredArgument(value, name));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function instanceLockPort(): number {
  const parsed = Number(process.env.INSTANCE_LOCK_PORT ?? DEFAULT_INSTANCE_LOCK_PORT);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('INSTANCE_LOCK_PORT must be an integer from 1 through 65535');
  }
  return parsed;
}

async function acquireOfflineServiceLock(): Promise<Server> {
  const server = createServer();
  const port = instanceLockPort();

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Discord Agent is still running on instance lock port ${port}; stop the service before restore`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(port, INSTANCE_LOCK_HOST, resolve);
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const paths = resolveApplicationPaths();

  if (command === 'backup') {
    const destinationDirectory = requiredArgument(args[0], 'destination-directory');
    const artifactName = args[1];
    const database = new Database(paths.databasePath, { fileMustExist: true });
    try {
      const artifact = await createOnlineBackup({
        database,
        destinationDirectory,
        applicationVersion: process.env.npm_package_version ?? 'unknown',
        artifactName,
      });
      console.log(artifact.directory);
    } finally {
      database.close();
    }
    return;
  }

  if (command === 'verify') {
    const artifactDirectory = requiredArgument(args[0], 'artifact-directory');
    const manifest = await verifyBackupArtifact(artifactDirectory);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === 'stage') {
    const artifactDirectory = requiredArgument(args[0], 'artifact-directory');
    const stagingPath = requiredArgument(args[1], 'staging-path');
    const maxSupportedSchemaVersion = parseNonNegativeInteger(args[2], 'max-schema-version');
    const staged = await stageVerifiedRestore({
      artifactDirectory,
      stagingPath,
      maxSupportedSchemaVersion,
    });
    console.log(staged.stagingPath);
    return;
  }

  if (command === 'activate') {
    const stagingPath = requiredArgument(args[0], 'staging-path');
    const expectedSchemaVersion = parseNonNegativeInteger(args[1], 'expected-schema-version');
    const rollbackPath = args[2] ?? `${paths.databasePath}.rollback`;
    const serviceLock = await acquireOfflineServiceLock();
    try {
      const activated = await activateStagedRestore({
        stagingPath,
        activePath: paths.databasePath,
        rollbackPath,
        expectedSchemaVersion,
        serviceOffline: true,
      });
      console.log(JSON.stringify(activated, null, 2));
    } finally {
      await closeServer(serviceLock);
    }
    return;
  }

  throw new Error(
    'Usage: database-maintenance <backup|verify|stage|activate> ...',
  );
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

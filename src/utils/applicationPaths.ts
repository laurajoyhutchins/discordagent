import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_FILENAME = 'discordagent.sqlite';
const LEGACY_PROJECTS_FILENAME = 'projects.json';
const WORKTREES_DIRECTORY = 'discordagent-worktrees';

export type ApplicationPathSelection =
  | 'stable-default'
  | 'legacy-source'
  | 'legacy-compiled'
  | 'explicit-database';

export interface ApplicationPaths {
  readonly dataRoot: string;
  readonly databasePath: string;
  readonly legacyProjectsPath: string;
  readonly worktreesBaseDir: string;
  readonly selection: ApplicationPathSelection;
  readonly notice?: string;
}

export interface ResolveApplicationPathsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly packageRoot?: string;
  readonly pathExists?: (path: string) => boolean;
}

function normalizeModulePath(modulePathOrUrl: string): string {
  return modulePathOrUrl.startsWith('file:')
    ? fileURLToPath(modulePathOrUrl)
    : modulePathOrUrl;
}

export function findPackageRoot(
  modulePathOrUrl: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  let current = dirname(normalizeModulePath(modulePathOrUrl));

  while (true) {
    if (pathExists(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate package.json above ${normalizeModulePath(modulePathOrUrl)}`);
    }
    current = parent;
  }
}

function containsApplicationState(
  dataRoot: string,
  pathExists: (path: string) => boolean,
): boolean {
  return pathExists(join(dataRoot, DATABASE_FILENAME))
    || pathExists(join(dataRoot, LEGACY_PROJECTS_FILENAME))
    || pathExists(join(dataRoot, WORKTREES_DIRECTORY));
}

function pathsForRoot(
  dataRoot: string,
  selection: ApplicationPathSelection,
  worktreesBaseDir?: string,
  notice?: string,
): ApplicationPaths {
  return {
    dataRoot,
    databasePath: join(dataRoot, DATABASE_FILENAME),
    legacyProjectsPath: join(dataRoot, LEGACY_PROJECTS_FILENAME),
    worktreesBaseDir: worktreesBaseDir ?? join(dataRoot, WORKTREES_DIRECTORY),
    selection,
    ...(notice ? { notice } : {}),
  };
}

export function resolveApplicationPaths(
  options: ResolveApplicationPathsOptions = {},
): ApplicationPaths {
  const env = options.env ?? process.env;
  const explicitDatabasePath = env.DATABASE_PATH?.trim();
  const explicitWorktreesBaseDir = env.WORKTREES_BASE_DIR?.trim();

  if (explicitDatabasePath) {
    const dataRoot = dirname(explicitDatabasePath);
    return {
      dataRoot,
      databasePath: explicitDatabasePath,
      legacyProjectsPath: join(dataRoot, LEGACY_PROJECTS_FILENAME),
      worktreesBaseDir: explicitWorktreesBaseDir || join(dataRoot, WORKTREES_DIRECTORY),
      selection: 'explicit-database',
    };
  }

  const pathExists = options.pathExists ?? existsSync;
  const packageRoot = options.packageRoot ?? findPackageRoot(import.meta.url, pathExists);
  const candidates = [
    {
      dataRoot: join(packageRoot, 'data'),
      selection: 'stable-default' as const,
    },
    {
      dataRoot: join(packageRoot, 'src', 'data'),
      selection: 'legacy-source' as const,
    },
    {
      dataRoot: join(packageRoot, 'dist', 'data'),
      selection: 'legacy-compiled' as const,
    },
  ];
  const populated = candidates.filter(candidate => containsApplicationState(candidate.dataRoot, pathExists));

  if (populated.length > 1) {
    const roots = populated.map(candidate => candidate.dataRoot).join(', ');
    throw new Error(
      `Detected multiple default application data directories with existing state: ${roots}. `
      + `Set DATABASE_PATH to the intended ${DATABASE_FILENAME} file before starting Discord Agent.`,
    );
  }

  const selected = populated[0] ?? candidates[0]!;
  const notice = selected.selection === 'legacy-source'
    ? `Using legacy source data directory at ${selected.dataRoot}; set DATABASE_PATH to select another location explicitly.`
    : selected.selection === 'legacy-compiled'
      ? `Using legacy compiled data directory at ${selected.dataRoot}; set DATABASE_PATH to select another location explicitly.`
      : undefined;

  return pathsForRoot(
    selected.dataRoot,
    selected.selection,
    explicitWorktreesBaseDir || undefined,
    notice,
  );
}

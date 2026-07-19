import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPackageRoot, resolveApplicationPaths } from './applicationPaths.js';

const tempDirectories: string[] = [];

function createPackageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'discordagent-paths-'));
  tempDirectories.push(root);
  writeFileSync(join(root, 'package.json'), '{"name":"discord-agent"}\n');
  mkdirSync(join(root, 'src', 'utils'), { recursive: true });
  mkdirSync(join(root, 'dist', 'utils'), { recursive: true });
  return root;
}

function createStateFile(root: string, relativePath: string): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'state');
  return path;
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('application paths', () => {
  it('finds the same package root from source-like and compiled-like module layouts', () => {
    const root = createPackageRoot();

    expect(findPackageRoot(join(root, 'src', 'utils', 'applicationPaths.ts'))).toBe(root);
    expect(findPackageRoot(join(root, 'dist', 'utils', 'applicationPaths.js'))).toBe(root);
  });

  it('uses one repository-root data directory for a fresh installation', () => {
    const root = createPackageRoot();

    expect(resolveApplicationPaths({ packageRoot: root, env: {} })).toEqual({
      dataRoot: join(root, 'data'),
      databasePath: join(root, 'data', 'discordagent.sqlite'),
      legacyProjectsPath: join(root, 'data', 'projects.json'),
      worktreesBaseDir: join(root, 'data', 'discordagent-worktrees'),
      selection: 'stable-default',
    });
  });

  it('preserves an explicit worktree path with the stable default database', () => {
    const root = createPackageRoot();
    const worktreesBaseDir = join(root, 'operator-worktrees');

    expect(resolveApplicationPaths({
      packageRoot: root,
      env: { WORKTREES_BASE_DIR: worktreesBaseDir },
    })).toEqual({
      dataRoot: join(root, 'data'),
      databasePath: join(root, 'data', 'discordagent.sqlite'),
      legacyProjectsPath: join(root, 'data', 'projects.json'),
      worktreesBaseDir,
      selection: 'stable-default',
    });
  });

  it('reuses a sole source-era data root without moving state', () => {
    const root = createPackageRoot();
    createStateFile(root, join('src', 'data', 'discordagent.sqlite'));

    const paths = resolveApplicationPaths({ packageRoot: root, env: {} });

    expect(paths.dataRoot).toBe(join(root, 'src', 'data'));
    expect(paths.databasePath).toBe(join(root, 'src', 'data', 'discordagent.sqlite'));
    expect(paths.legacyProjectsPath).toBe(join(root, 'src', 'data', 'projects.json'));
    expect(paths.worktreesBaseDir).toBe(join(root, 'src', 'data', 'discordagent-worktrees'));
    expect(paths.selection).toBe('legacy-source');
    expect(paths.notice).toContain('legacy source data directory');
  });

  it('reuses a sole compiled-era data root without moving state', () => {
    const root = createPackageRoot();
    createStateFile(root, join('dist', 'data', 'discordagent.sqlite'));

    const paths = resolveApplicationPaths({ packageRoot: root, env: {} });

    expect(paths.dataRoot).toBe(join(root, 'dist', 'data'));
    expect(paths.selection).toBe('legacy-compiled');
    expect(paths.notice).toContain('legacy compiled data directory');
  });

  it('uses a historical projects.json file to select the legacy import root', () => {
    const root = createPackageRoot();
    createStateFile(root, join('src', 'data', 'projects.json'));

    const paths = resolveApplicationPaths({ packageRoot: root, env: {} });

    expect(paths.dataRoot).toBe(join(root, 'src', 'data'));
    expect(paths.legacyProjectsPath).toBe(join(root, 'src', 'data', 'projects.json'));
  });

  it('fails safely when both historical databases contain state', () => {
    const root = createPackageRoot();
    createStateFile(root, join('src', 'data', 'discordagent.sqlite'));
    createStateFile(root, join('dist', 'data', 'discordagent.sqlite'));

    expect(() => resolveApplicationPaths({ packageRoot: root, env: {} }))
      .toThrow(/multiple default application data directories.*DATABASE_PATH/i);
  });

  it('fails safely when stable and historical defaults both contain state', () => {
    const root = createPackageRoot();
    createStateFile(root, join('data', 'discordagent.sqlite'));
    createStateFile(root, join('src', 'data', 'discordagent.sqlite'));

    expect(() => resolveApplicationPaths({ packageRoot: root, env: {} }))
      .toThrow(/multiple default application data directories.*DATABASE_PATH/i);
  });

  it('preserves explicit database and worktree paths even when defaults conflict', () => {
    const root = createPackageRoot();
    createStateFile(root, join('src', 'data', 'discordagent.sqlite'));
    createStateFile(root, join('dist', 'data', 'discordagent.sqlite'));
    const databasePath = join(root, 'operator', 'state.sqlite');
    const worktreesBaseDir = join(root, 'operator', 'worktrees');

    expect(resolveApplicationPaths({
      packageRoot: root,
      env: {
        DATABASE_PATH: databasePath,
        WORKTREES_BASE_DIR: worktreesBaseDir,
      },
    })).toEqual({
      dataRoot: join(root, 'operator'),
      databasePath,
      legacyProjectsPath: join(root, 'operator', 'projects.json'),
      worktreesBaseDir,
      selection: 'explicit-database',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { Project } from '../../types.js';

const mockSpawnStream = vi.hoisted(() => vi.fn());
const mockIsCliAvailable = vi.hoisted(() => vi.fn());
const mockFetchReviewBody = vi.hoisted(() => vi.fn());
const mockGetProjects = vi.hoisted(() => vi.fn());

vi.mock('./roborevCli.js', () => ({
  spawnStream: mockSpawnStream,
  isCliAvailable: mockIsCliAvailable,
  fetchReviewBody: mockFetchReviewBody,
}));

vi.mock('../../services/projectStore.js', () => ({
  getAllProjects: mockGetProjects,
}));

vi.mock('../../config.js', () => ({
  config: { roborevCliPath: 'roborev' },
}));

function fakeProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  Object.defineProperty(proc, 'stdout', {
    value: new Readable({ read() {} }),
    writable: false,
  });
  Object.defineProperty(proc, 'stderr', {
    value: new Readable({ read() {} }),
    writable: false,
  });
  proc.kill = vi.fn();
  return proc;
}

function project(): Project {
  return {
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'category-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
    roborevChannelId: 'roborev-1',
  };
}

describe('RoboRev review source regressions', () => {
  beforeEach(() => {
    mockSpawnStream.mockReset();
    mockIsCliAvailable.mockReset();
    mockFetchReviewBody.mockReset();
    mockGetProjects.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts the stream when RoboRev is enabled after runtime startup', async () => {
    mockGetProjects.mockReturnValue([]);
    mockIsCliAvailable.mockResolvedValue(true);
    const proc = fakeProcess();
    mockSpawnStream.mockReturnValue(proc);

    const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
    const { notifyRoborevConfigurationChanged } = await import('./roborevLifecycle.js');
    const source = createRoborevReviewSource({
      cliPath: 'roborev',
      getProjects: mockGetProjects,
      fetchBody: mockFetchReviewBody,
    });

    const disposable = await source.start(vi.fn());
    expect(mockSpawnStream).not.toHaveBeenCalled();

    mockGetProjects.mockReturnValue([project()]);
    notifyRoborevConfigurationChanged();

    await vi.waitFor(() => {
      expect(mockSpawnStream).toHaveBeenCalledOnce();
    });
    await disposable.dispose();
  });

  it('resets exponential backoff after the stream remains stable', async () => {
    vi.useFakeTimers();
    mockGetProjects.mockReturnValue([project()]);
    mockIsCliAvailable.mockResolvedValue(true);
    const processes: ChildProcess[] = [];
    mockSpawnStream.mockImplementation(() => {
      const proc = fakeProcess();
      processes.push(proc);
      return proc;
    });

    const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
    const source = createRoborevReviewSource({
      cliPath: 'roborev',
      getProjects: mockGetProjects,
      fetchBody: mockFetchReviewBody,
    });
    const disposable = await source.start(vi.fn());

    processes[0]!.emit('close', 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockSpawnStream).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    processes[1]!.emit('close', 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(mockSpawnStream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSpawnStream).toHaveBeenCalledTimes(3);

    await disposable.dispose();
  });

  it('schedules only one restart when a failed spawn emits both error and close', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetProjects.mockReturnValue([project()]);
    mockIsCliAvailable.mockResolvedValue(true);
    const proc = fakeProcess();
    mockSpawnStream.mockReturnValue(proc);

    const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
    const source = createRoborevReviewSource({
      cliPath: 'roborev',
      getProjects: mockGetProjects,
      fetchBody: mockFetchReviewBody,
    });
    const disposable = await source.start(vi.fn());

    proc.emit('error', new Error('spawn failed'));
    proc.emit('close', 1);

    expect(vi.getTimerCount()).toBe(1);
    await disposable.dispose();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { Project } from '../../types.js';
import type { ReviewSource } from '../reviewSource.js';

// ── Hoisted mocks ──────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────

function fakeProcess() {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  Object.defineProperty(proc, 'stdout', { value: stdout, writable: false });
  Object.defineProperty(proc, 'stderr', { value: stderr, writable: false });
  proc.kill = vi.fn();
  Object.defineProperty(proc, 'pid', { value: 12345, writable: false });
  return proc;
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: 'factory-floor',
    workingDirectory: '/repos/factory-floor',
    categoryId: 'cat-1',
    agentChannelId: 'agent-1',
    defaultProvider: 'claude',
    roborevChannelId: 'review-1',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('RoborevReviewSource', () => {
  beforeEach(() => {
    mockSpawnStream.mockReset();
    mockIsCliAvailable.mockReset();
    mockFetchReviewBody.mockReset();
    mockGetProjects.mockReset();
  });

  describe('startup conditions', () => {
    it('returns a no-op disposable when no projects have roborev enabled', async () => {
      mockGetProjects.mockReturnValue([
        { name: 'test', workingDirectory: '/test', categoryId: 'c', agentChannelId: 'a', defaultProvider: 'claude' },
      ]);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(vi.fn());

      expect(disposable).toBeDefined();
      await expect(disposable.dispose()).resolves.toBeUndefined();
      expect(mockSpawnStream).not.toHaveBeenCalled();
      expect(mockIsCliAvailable).not.toHaveBeenCalled();
    });

    it('returns a no-op disposable when roborev CLI is unavailable', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(false);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(vi.fn());

      expect(disposable).toBeDefined();
      await expect(disposable.dispose()).resolves.toBeUndefined();
      expect(mockSpawnStream).not.toHaveBeenCalled();
    });

    it('spawns the stream process when CLI is available and projects exist', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      mockSpawnStream.mockReturnValue(fakeProcess());

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(vi.fn());

      expect(mockSpawnStream).toHaveBeenCalledWith('roborev');
      await disposable.dispose();
    });

    it('cannot start twice', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      mockSpawnStream.mockReturnValue(fakeProcess());

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      await source.start(vi.fn());

      await expect(source.start(vi.fn())).rejects.toThrow('already started');
    });
  });

  describe('event processing', () => {
    it('calls publish for each review.started event from the stream', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      const proc = fakeProcess();
      mockSpawnStream.mockReturnValue(proc);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const publish = vi.fn(async () => undefined);
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(publish);

      (proc.stdout as NodeJS.ReadableStream).emit('data', Buffer.from(JSON.stringify({
        type: 'review.started',
        ts: '2026-07-18T12:00:00Z',
        job_id: 42,
        repo: '/repos/factory-floor',
        repo_name: 'factory-floor',
        sha: 'abcdef1234567890',
        agent: 'reviewer',
      }) + '\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'roborev', projectId: 'factory-floor', status: 'started' }),
      );

      await disposable.dispose();
    });

    it('ignores events for unknown repositories', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      const proc = fakeProcess();
      mockSpawnStream.mockReturnValue(proc);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const publish = vi.fn(async () => undefined);
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(publish);

      (proc.stdout as NodeJS.ReadableStream).emit('data', Buffer.from(JSON.stringify({
        type: 'review.started',
        ts: '2026-07-18T12:00:00Z',
        job_id: 99,
        repo: '/repos/unknown-repo',
        repo_name: 'unknown-repo',
        sha: 'deadbeef',
        agent: 'reviewer',
      }) + '\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(publish).not.toHaveBeenCalled();
      await disposable.dispose();
    });

    it('tolerates fetchReviewBody failures without terminating', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      const proc = fakeProcess();
      mockSpawnStream.mockReturnValue(proc);
      mockFetchReviewBody.mockRejectedValue(new Error('show failed'));

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const publish = vi.fn(async () => undefined);
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(publish);

      (proc.stdout as NodeJS.ReadableStream).emit('data', Buffer.from(JSON.stringify({
        type: 'review.completed',
        ts: '2026-07-18T12:00:00Z',
        job_id: 42,
        repo: '/repos/factory-floor',
        repo_name: 'factory-floor',
        sha: 'abcdef1234567890',
        agent: 'reviewer',
        verdict: 'A',
      }) + '\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetchReviewBody).toHaveBeenCalledWith(42);
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ status: 'passed' }));
      await disposable.dispose();
    });

    it('logs non-JSON lines without crashing', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      const proc = fakeProcess();
      mockSpawnStream.mockReturnValue(proc);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const publish = vi.fn(async () => undefined);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(publish);

      (proc.stdout as NodeJS.ReadableStream).emit('data', Buffer.from('not json\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith('[roborev] Non-JSON line:', expect.any(String));
      consoleSpy.mockRestore();
      await disposable.dispose();
    });

    it('continues running after discord delivery failures', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);
      const proc = fakeProcess();
      mockSpawnStream.mockReturnValue(proc);

      const { createRoborevReviewSource } = await import('./roborevReviewSource.js');
      const publish = vi.fn(async () => { throw new Error('Discord rate limited'); });
      const source = createRoborevReviewSource({
        cliPath: 'roborev',
        getProjects: mockGetProjects,
        fetchBody: mockFetchReviewBody,
      });
      const disposable = await source.start(publish);

      (proc.stdout as NodeJS.ReadableStream).emit('data', Buffer.from(JSON.stringify({
        type: 'review.started',
        ts: '2026-07-18T12:00:00Z',
        job_id: 42,
        repo: '/repos/factory-floor',
        repo_name: 'factory-floor',
        sha: 'abcdef1234567890',
        agent: 'reviewer',
      }) + '\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(publish).toHaveBeenCalled();
      expect(proc.listenerCount('close')).toBe(1);
      expect(proc.listenerCount('error')).toBe(1);
      await disposable.dispose();
    });
  });

  describe('lifecycle and restart', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('schedules one restart after unexpected stream exit', async () => {
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

      expect(mockSpawnStream).toHaveBeenCalledTimes(1);

      proc.emit('close', null);

      expect(vi.getTimerCount()).toBe(1);

      await disposable.dispose();
    });

    it('respects bounded exponential backoff on repeated failures', async () => {
      mockGetProjects.mockReturnValue([project()]);
      mockIsCliAvailable.mockResolvedValue(true);

      let spawnCount = 0;
      const processes: Array<ReturnType<typeof fakeProcess>> = [];
      mockSpawnStream.mockImplementation(() => {
        spawnCount++;
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
      expect(spawnCount).toBe(1);

      // First exit → backoff ~1000ms
      processes[0]!.emit('close', null);
      await vi.advanceTimersByTimeAsync(1000);
      expect(spawnCount).toBe(2);

      // Second exit → backoff ~2000ms
      processes[1]!.emit('close', null);
      await vi.advanceTimersByTimeAsync(2000);
      expect(spawnCount).toBe(3);

      // Third exit → backoff ~4000ms
      processes[2]!.emit('close', null);
      await vi.advanceTimersByTimeAsync(4000);
      expect(spawnCount).toBe(4);

      await disposable.dispose();
    });

    it('shutdown cancels restart timers and terminates the active child process', async () => {
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

      expect(proc.kill).not.toHaveBeenCalled();
      await disposable.dispose();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('shutdown cancels pending restart timers', async () => {
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

      proc.emit('close', 0);
      expect(vi.getTimerCount()).toBe(1);

      await disposable.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not allow two concurrent stream processes', async () => {
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
      expect(mockSpawnStream).toHaveBeenCalledTimes(1);

      proc.emit('close', null);
      expect(vi.getTimerCount()).toBe(1);

      const proc2 = fakeProcess();
      mockSpawnStream.mockReset();
      mockSpawnStream.mockReturnValue(proc2);

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockSpawnStream).toHaveBeenCalledTimes(1);

      expect(proc2.kill).not.toHaveBeenCalled();
      await disposable.dispose();
      expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

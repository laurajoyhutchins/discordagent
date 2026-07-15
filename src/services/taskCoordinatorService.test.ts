import { afterEach, describe, expect, it } from 'vitest';
import type { TaskCoordinator } from '../coordinator/taskCoordinator.js';
import {
  clearTaskCoordinator,
  getTaskCoordinator,
  setTaskCoordinator,
} from './taskCoordinatorService.js';

afterEach(() => clearTaskCoordinator());

describe('taskCoordinatorService', () => {
  it('fails clearly before runtime initialization', () => {
    expect(() => getTaskCoordinator()).toThrow(/not initialized/i);
  });

  it('returns the coordinator installed by runtime startup', () => {
    const coordinator = {} as TaskCoordinator;
    setTaskCoordinator(coordinator);
    expect(getTaskCoordinator()).toBe(coordinator);
  });
});

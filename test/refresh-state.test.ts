import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshScheduler } from '../src/content/refresh-state';

describe('RefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces scheduled runs', async () => {
    const task = vi.fn();
    const scheduler = new RefreshScheduler(task, 100);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(100);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('coalesces requests received while the task is running', async () => {
    let releaseFirstRun!: () => void;
    const task = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirstRun = resolve)))
      .mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler(task, 100);

    const firstRun = scheduler.run();
    const pendingRun = scheduler.run();
    scheduler.run();

    expect(pendingRun).toBe(firstRun);
    expect(task).toHaveBeenCalledTimes(1);

    releaseFirstRun();
    await firstRun;
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('runs immediately and cancels a scheduled invocation', async () => {
    const task = vi.fn();
    const scheduler = new RefreshScheduler(task, 100);

    scheduler.schedule();
    await scheduler.run();
    await vi.advanceTimersByTimeAsync(100);

    expect(task).toHaveBeenCalledTimes(1);
  });
});

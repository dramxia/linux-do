import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  batchFetchWithBackoff,
  parseRetryAfter,
  RateLimitError,
} from '../src/content/api-rate-limiter';

describe('parseRetryAfter', () => {
  it('returns 0 for null or empty header', () => {
    expect(parseRetryAfter(null)).toBe(0);
    expect(parseRetryAfter('')).toBe(0);
    expect(parseRetryAfter('   ')).toBe(0);
  });

  it('parses a pure-integer seconds value to milliseconds', () => {
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('1')).toBe(1000);
    expect(parseRetryAfter('120')).toBe(120000);
  });

  it('parses an HTTP-date header as the delta from now', () => {
    const now = new Date('2026-07-22T12:00:00Z');
    const future = new Date('2026-07-22T12:00:30Z');
    expect(parseRetryAfter(future.toUTCString(), now)).toBe(30000);
  });

  it('clamps a past HTTP-date to 0 (no negative wait)', () => {
    const now = new Date('2026-07-22T12:00:00Z');
    const past = new Date('2026-07-22T11:59:00Z');
    expect(parseRetryAfter(past.toUTCString(), now)).toBe(0);
  });

  it('returns 0 for an unparseable header value', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBe(0);
  });
});

describe('RateLimitError', () => {
  it('carries retryAfterMs and a default message', () => {
    const err = new RateLimitError(5000);
    expect(err.name).toBe('RateLimitError');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain('429');
  });

  it('accepts a custom message', () => {
    const err = new RateLimitError(1000, 'custom');
    expect(err.message).toBe('custom');
  });
});

describe('batchFetchWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty results and failures for empty input', async () => {
    const { results, failures } = await batchFetchWithBackoff({
      items: [],
      task: async () => 'x',
      concurrency: 5,
    });
    expect(results).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('runs all items successfully and preserves order', async () => {
    const items = ['a', 'b', 'c'];
    const task = vi.fn(async (item: string) => item.toUpperCase());
    const { results, failures } = await batchFetchWithBackoff({
      items,
      task,
      concurrency: 5,
    });
    expect(results.map((r) => r.value)).toEqual(['A', 'B', 'C']);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(failures).toEqual([]);
  });

  it('limits concurrency to the configured value', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const task = async (item: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return item;
    };
    await batchFetchWithBackoff({ items, task, concurrency: 5 });
    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it('uses concurrency = items.length when items < concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2];
    const task = async (item: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return item;
    };
    await batchFetchWithBackoff({ items, task, concurrency: 10 });
    expect(maxActive).toBe(2);
  });

  it('retries on RateLimitError up to maxRetries, then succeeds', async () => {
    const items = ['a'];
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new RateLimitError(1000);
      return 'ok';
    });
    const promise = batchFetchWithBackoff({
      items,
      task,
      concurrency: 1,
      maxRetries: 3,
      initialBackoffMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const { results, failures } = await promise;
    expect(results.map((r) => r.value)).toEqual(['ok']);
    expect(failures).toEqual([]);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('records a failure after maxRetries exhausted on persistent 429', async () => {
    const items = ['a'];
    const task = vi.fn(async () => {
      throw new RateLimitError(100);
    });
    const promise = batchFetchWithBackoff({
      items,
      task,
      concurrency: 1,
      maxRetries: 2,
      initialBackoffMs: 100,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const { results, failures } = await promise;
    expect(results).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.item).toBe('a');
    expect(failures[0]?.error).toBeInstanceOf(RateLimitError);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-RateLimitError errors', async () => {
    const items = ['a', 'b'];
    const task = vi.fn(async (item: string) => {
      if (item === 'a') throw new Error('boom');
      return item;
    });
    const { results, failures } = await batchFetchWithBackoff({
      items,
      task,
      concurrency: 2,
      maxRetries: 3,
    });
    expect(results.map((r) => r.value)).toEqual(['b']);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.item).toBe('a');
    expect(failures[0]?.error.message).toBe('boom');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('waits at least Retry-After before retrying', async () => {
    const items = ['a'];
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new RateLimitError(2000);
      return 'ok';
    });
    const promise = batchFetchWithBackoff({
      items,
      task,
      concurrency: 1,
      maxRetries: 1,
      initialBackoffMs: 100,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const { results } = await promise;
    expect(results.map((r) => r.value)).toEqual(['ok']);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff when Retry-After header is absent (retryAfterMs=0)', async () => {
    const items = ['a'];
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new RateLimitError(0);
      return 'ok';
    });
    const promise = batchFetchWithBackoff({
      items,
      task,
      concurrency: 1,
      maxRetries: 1,
      initialBackoffMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const { results } = await promise;
    expect(results.map((r) => r.value)).toEqual(['ok']);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('caps exponential backoff at maxBackoffMs', async () => {
    const items = ['a'];
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls <= 4) throw new RateLimitError(0);
      return 'ok';
    });
    const promise = batchFetchWithBackoff({
      items,
      task,
      concurrency: 1,
      maxRetries: 4,
      initialBackoffMs: 1000,
      maxBackoffMs: 2000,
    });
    // Backoff sequence: 1000, 2000(capped from 2000), 2000(capped from 4000), 2000(capped from 8000)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const { results, failures } = await promise;
    expect(results.map((r) => r.value)).toEqual(['ok']);
    expect(task).toHaveBeenCalledTimes(5);
    void failures;
  });
});

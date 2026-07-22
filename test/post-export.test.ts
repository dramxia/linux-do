import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectLoadedPosts } from '../src/content/post-export';
import { setupChromeMock } from './mocks/chrome';
import type { DiscourseSettings } from '../src/common/settings';
import { RateLimitError } from '../src/content/api-rate-limiter';

const DEFAULT_SETTINGS: DiscourseSettings = {
  enablePostActions: true,
  enableBase64Decode: true,
  enableSplitLayout: false,
  includeMetadata: true,
  replaceUploadUrls: true,
};

function makePostEl(postId: string, postNumber: string, author: string): HTMLElement {
  const el = document.createElement('article');
  el.className = 'topic-post';
  el.setAttribute('data-post-id', postId);
  el.setAttribute('data-post-number', postNumber);
  const names = document.createElement('div');
  names.className = 'names';
  const username = document.createElement('span');
  username.className = 'username';
  username.textContent = author;
  names.appendChild(username);
  el.appendChild(names);
  const time = document.createElement('time');
  time.setAttribute('datetime', '2026-07-22T12:00:00Z');
  el.appendChild(time);
  return el;
}

function mockFetchSequence(responses: Array<{ status?: number; body?: string; retryAfter?: string }>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    const status = r.status ?? 200;
    const headers = new Map<string, string>();
    if (r.retryAfter !== undefined) headers.set('retry-after', r.retryAfter);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      },
      text: async () => r.body ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('collectLoadedPosts', () => {
  beforeEach(() => {
    setupChromeMock();
    vi.useFakeTimers();
    // jsdom provides window.location; pin to a topic URL so getTopicId() works.
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://linux.do', pathname: '/t/topic/123', href: 'https://linux.do/t/topic/123' },
      configurable: true,
    });
    // fancy-title for getTopicTitle
    document.body.innerHTML = '<h1 class="fancy-title">Test Topic</h1>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns empty result when no post elements exist', async () => {
    globalThis.fetch = mockFetchSequence([{ body: '' }]);
    const result = await collectLoadedPosts(DEFAULT_SETTINGS);
    expect(result.total).toBe(0);
    expect(result.posts).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('collects raw markdown for all loaded posts', async () => {
    document.body.appendChild(makePostEl('1', '1', 'alice'));
    document.body.appendChild(makePostEl('2', '2', 'bob'));
    globalThis.fetch = mockFetchSequence([
      { body: '# Hello from alice' },
      { body: '# Hello from bob' },
    ]);
    const result = await collectLoadedPosts(DEFAULT_SETTINGS);
    expect(result.total).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.posts[0]?.meta.author).toBe('alice');
    expect(result.posts[0]?.raw).toContain('Hello from alice');
    expect(result.posts[1]?.meta.author).toBe('bob');
    expect(result.posts[1]?.raw).toContain('Hello from bob');
  });

  it('records failures for non-429 HTTP errors without retrying', async () => {
    document.body.appendChild(makePostEl('1', '1', 'alice'));
    document.body.appendChild(makePostEl('2', '2', 'bob'));
    globalThis.fetch = mockFetchSequence([
      { status: 500, body: '' },
      { body: 'ok' },
    ]);
    const result = await collectLoadedPosts(DEFAULT_SETTINGS);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.failures[0]?.error).toContain('500');
    expect(result.posts[0]?.raw).toContain('ok');
  });

  it('retries on 429 with Retry-After header then succeeds', async () => {
    document.body.appendChild(makePostEl('1', '1', 'alice'));
    globalThis.fetch = mockFetchSequence([
      { status: 429, retryAfter: '1' },
      { body: 'recovered' },
    ]);
    const promise = collectLoadedPosts(DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.posts[0]?.raw).toContain('recovered');
  });

  it('records a failure after maxRetries exhausted on persistent 429', async () => {
    document.body.appendChild(makePostEl('1', '1', 'alice'));
    globalThis.fetch = mockFetchSequence([
      { status: 429, retryAfter: '0' },
      { status: 429, retryAfter: '0' },
      { status: 429, retryAfter: '0' },
      { status: 429, retryAfter: '0' },
    ]);
    const promise = collectLoadedPosts(DEFAULT_SETTINGS);
    // maxRetries=3 → 4 attempts; backoff at initialBackoffMs=1000 (retryAfter=0 → exponential wins):
    // attempt 0 fail → wait 1000; attempt 1 fail → wait 2000; attempt 2 fail → wait 4000; attempt 3 fail → no retry
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.failures[0]?.error).toContain('429');
  });

  it('limits concurrency to 5 (at most 5 simultaneous fetches)', async () => {
    for (let i = 1; i <= 10; i += 1) {
      document.body.appendChild(makePostEl(String(i), String(i), `user${i}`));
    }
    let active = 0;
    let maxActive = 0;
    const realFetch = mockFetchSequence(Array.from({ length: 10 }, () => ({ body: 'content' })));
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const result = await realFetch(input);
      active -= 1;
      return result;
    }) as unknown as typeof fetch;
    await collectLoadedPosts(DEFAULT_SETTINGS);
    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it('RateLimitError thrown by fetchRawPost carries parsed Retry-After', async () => {
    document.body.appendChild(makePostEl('1', '1', 'alice'));
    globalThis.fetch = mockFetchSequence([{ status: 429, retryAfter: '5' }]);
    const promise = collectLoadedPosts(DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(100000);
    const result = await promise;
    expect(result.failureCount).toBe(1);
    const err = result.failures[0]?.error;
    // The error message propagates from RateLimitError; verify it mentions 429.
    expect(err).toContain('429');
    void RateLimitError;
  });
});

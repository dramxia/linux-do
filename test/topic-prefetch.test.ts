import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/common/settings';
import { clearTopicResponsePrefetches } from '../src/content/topic-api';
import { TopicPrefetchCoordinator } from '../src/content/topic-prefetch';

const enabledSettings = { ...DEFAULT_SETTINGS, enableSplitReading: true };

function topicResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 123,
      title: 'Topic',
      posts_count: 1,
      post_stream: {
        posts: [
          {
            id: 1,
            topic_id: 123,
            post_number: 1,
            username: 'author',
            created_at: '2026-08-23T00:00:00.000Z',
            cooked: '<p>article</p>',
          },
        ],
        stream: [1],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('topic prefetch coordinator', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/t/topic/123/40');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  afterEach(() => {
    clearTopicResponsePrefetches();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts prefetch immediately when settings are available', () => {
    const mockedFetch = vi.fn().mockImplementation(() => Promise.resolve(topicResponse()));
    vi.stubGlobal('fetch', mockedFetch);

    new TopicPrefetchCoordinator().update(enabledSettings);

    expect(mockedFetch).toHaveBeenCalledOnce();
    expect(String(mockedFetch.mock.calls[0]?.[0])).toContain('/t/123.json');
  });

  it('prefetches a new SPA route and aborts the old route request', async () => {
    const signals: AbortSignal[] = [];
    const mockedFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', mockedFetch);
    const coordinator = new TopicPrefetchCoordinator();
    coordinator.update(enabledSettings);

    window.history.replaceState({}, '', '/t/another/456');
    window.dispatchEvent(new Event('page:change'));

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(String(mockedFetch.mock.calls[1]?.[0])).toContain('/t/456.json');
  });

  it('does not prefetch when disabled or narrow', () => {
    const mockedFetch = vi.fn().mockImplementation(() => Promise.resolve(topicResponse()));
    vi.stubGlobal('fetch', mockedFetch);
    const disabled = new TopicPrefetchCoordinator();
    disabled.update({ ...enabledSettings, enableSplitReading: false });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    new TopicPrefetchCoordinator().update(enabledSettings);

    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

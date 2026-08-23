import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireTopicResponse,
  buildPostsUrl,
  clearTopicResponsePrefetches,
  fetchPostReplies,
  fetchPosts,
  getTopicResponsePrefetchStatus,
  parseTopicResponse,
  prefetchTopicResponse,
  TopicDataSource,
  type TopicPost,
  type TopicResponse,
} from '../src/content/topic-api';

function post(id: number, postNumber: number): TopicPost {
  return {
    id,
    topic_id: 123,
    post_number: postNumber,
    username: `user-${postNumber}`,
    created_at: '2026-08-22T00:00:00.000Z',
    cooked: `<p>post ${postNumber}</p>`,
  };
}

function topic(posts: TopicPost[] = [post(1, 1)]): TopicResponse {
  return {
    id: 123,
    title: 'Topic',
    posts_count: 4,
    post_stream: {
      posts,
      stream: [1, 2, 3, 4],
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearTopicResponsePrefetches();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('topic API', () => {
  it('builds repeated post_ids parameters without credentials', () => {
    const url = buildPostsUrl('123', [9, 7]);
    expect(url).toContain('/t/123/posts.json?');
    const params = new URL(url, 'https://linux.do').searchParams;
    expect(params.getAll('post_ids[]')).toEqual(['9', '7']);
  });

  it('orders a posts response by the requested stream IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          post_stream: { posts: [post(7, 7), post(9, 9)] },
        }),
      ),
    );

    const result = await fetchPosts('123', [9, 7]);
    expect(result.map((item) => item.id)).toEqual([9, 7]);
  });

  it('shares one topic response across floor locations of the same topic', async () => {
    const mockedFetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(topic())));
    vi.stubGlobal('fetch', mockedFetch);

    prefetchTopicResponse({ topicId: '123', floor: 20 });
    expect(getTopicResponsePrefetchStatus({ topicId: '123', floor: 20 })).toBe('hit');
    const [first, second] = await Promise.all([
      acquireTopicResponse({ topicId: '123', floor: 20 }),
      acquireTopicResponse({ topicId: '123', floor: 20 }),
    ]);
    prefetchTopicResponse({ topicId: '123', floor: 40 });
    await acquireTopicResponse({ topicId: '123', floor: 40 });

    expect(first).toBe(second);
    expect(mockedFetch).toHaveBeenCalledOnce();
    expect(String(mockedFetch.mock.calls[0]?.[0])).toContain('/t/123.json');
  });

  it('cancels only an aborted prefetch consumer and keeps the shared request alive', async () => {
    let resolveTopic!: (response: Response) => void;
    let sharedSignal: AbortSignal | undefined;
    const topicResponse = new Promise<Response>((resolve) => {
      resolveTopic = resolve;
    });
    const mockedFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      sharedSignal = init?.signal as AbortSignal | undefined;
      return topicResponse;
    });
    vi.stubGlobal('fetch', mockedFetch);
    prefetchTopicResponse({ topicId: '123' });

    const controller = new AbortController();
    const abortedConsumer = acquireTopicResponse({ topicId: '123' }, controller.signal);
    controller.abort();
    expect(sharedSignal?.aborted).toBe(false);

    const remainingConsumer = acquireTopicResponse({ topicId: '123' });
    resolveTopic(jsonResponse(topic()));
    await Promise.all([
      expect(abortedConsumer).rejects.toMatchObject({ name: 'AbortError' }),
      expect(remainingConsumer).resolves.toMatchObject({ id: 123 }),
    ]);
    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it('falls back to one activation request after a prefetched topic fails', async () => {
    const mockedFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('prefetch failed'))
      .mockResolvedValueOnce(jsonResponse(topic()));
    vi.stubGlobal('fetch', mockedFetch);

    prefetchTopicResponse({ topicId: '123' });
    await expect(acquireTopicResponse({ topicId: '123' })).resolves.toMatchObject({ id: 123 });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('shares the single activation fallback between concurrent prefetch consumers', async () => {
    let rejectPrefetch!: (reason: unknown) => void;
    let resolveFallback!: (response: Response) => void;
    const prefetchRequest = new Promise<Response>((_resolve, reject) => {
      rejectPrefetch = reject;
    });
    const fallbackRequest = new Promise<Response>((resolve) => {
      resolveFallback = resolve;
    });
    const mockedFetch = vi
      .fn()
      .mockReturnValueOnce(prefetchRequest)
      .mockReturnValueOnce(fallbackRequest);
    vi.stubGlobal('fetch', mockedFetch);
    prefetchTopicResponse({ topicId: '123' });

    const first = acquireTopicResponse({ topicId: '123' });
    const second = acquireTopicResponse({ topicId: '123' });
    rejectPrefetch(new Error('prefetch failed'));
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    resolveFallback(jsonResponse(topic()));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('shares a posts cooldown across callers and allows aborting the wait', async () => {
    vi.useFakeTimers();
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (mockedFetch.mock.calls.length === 1) {
        return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
      }
      const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
      return Promise.resolve(
        jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } }),
      );
    });
    vi.stubGlobal('fetch', mockedFetch);

    const first = fetchPosts('123', [2]);
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const aborted = fetchPosts('123', [3], controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedFetch).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(mockedFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(first).resolves.toMatchObject([{ id: 2 }]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('loads direct replies after the requested floor', async () => {
    const replies = [post(7, 7), post(9, 9)];
    const mockedFetch = vi.fn().mockResolvedValue(jsonResponse(replies));
    vi.stubGlobal('fetch', mockedFetch);

    await expect(fetchPostReplies(42, 7)).resolves.toEqual(replies);
    expect(mockedFetch).toHaveBeenCalledWith('/posts/42/replies?after=7', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('rejects malformed direct replies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ posts: [] })));
    await expect(fetchPostReplies(42)).rejects.toThrow('回复数据格式无效');
  });

  it('detects the article by post_number instead of response position', async () => {
    const response = topic([post(2, 2), post(1, 1)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(response)));

    const source = await TopicDataSource.create('123');
    expect(source.article.id).toBe(1);
    expect(source.commentPostIds).toEqual([2, 3, 4]);
  });

  it('fetches only missing page posts and preserves stream order', async () => {
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit'))
        return Promise.resolve(jsonResponse(topic([post(1, 1)])));
      return Promise.resolve(jsonResponse({ post_stream: { posts: [post(3, 3), post(2, 2)] } }));
    });
    vi.stubGlobal('fetch', mockedFetch);

    const source = await TopicDataSource.create('123');
    const result = await source.loadPage(1, 2);
    expect(result.map((item) => item.id)).toEqual([2, 3]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('loads 40 comments with at most two concurrent batches of 20 posts', async () => {
    const stream = Array.from({ length: 41 }, (_, index) => index + 1);
    const article = post(1, 1);
    let postsRequestCount = 0;
    let releaseFirstBatch: (() => void) | undefined;
    const postsRequestUrls: string[] = [];
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit')) {
        return Promise.resolve(
          jsonResponse({
            ...topic([article]),
            posts_count: stream.length,
            post_stream: { posts: [article], stream },
          }),
        );
      }

      postsRequestCount += 1;
      postsRequestUrls.push(url);
      const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
      const response = jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } });
      if (postsRequestCount === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirstBatch = () => resolve(response);
        });
      }
      return Promise.resolve(response);
    });
    vi.stubGlobal('fetch', mockedFetch);

    const source = await TopicDataSource.create('123');
    const loading = source.loadPage(1, 40);
    await Promise.resolve();

    expect(postsRequestCount).toBe(2);
    expect(postsRequestUrls[0]).toBeDefined();
    expect(postsRequestUrls[1]).toBeDefined();
    expect(
      new URL(postsRequestUrls[0]!, 'https://linux.do').searchParams.getAll('post_ids[]'),
    ).toHaveLength(20);
    expect(
      new URL(postsRequestUrls[1]!, 'https://linux.do').searchParams.getAll('post_ids[]'),
    ).toHaveLength(20);

    releaseFirstBatch?.();
    const result = await loading;

    expect(postsRequestCount).toBe(2);
    expect(result.map((item) => item.id)).toEqual(stream.slice(1));
  });

  it('prefetches reply targets outside the current page', async () => {
    const stream = Array.from({ length: 12 }, (_, index) => index + 101);
    const article = post(101, 1);
    const parent = post(102, 2);
    const reply = { ...post(112, 12), reply_to_post_number: 2 };
    const postsById = new Map([parent, reply].map((item) => [item.id, item]));
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit')) {
        return Promise.resolve(
          jsonResponse({
            ...topic([article]),
            posts_count: stream.length,
            post_stream: { posts: [article], stream },
          }),
        );
      }
      const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
      return Promise.resolve(
        jsonResponse({
          post_stream: { posts: ids.flatMap((id) => postsById.get(id) || []) },
        }),
      );
    });
    vi.stubGlobal('fetch', mockedFetch);

    const source = await TopicDataSource.create('123');
    const result = await source.loadPage(2, 10);

    expect(result).toEqual([reply]);
    expect(source.getCachedPostByNumber(2)).toEqual(parent);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it('keeps an unavailable stream entry as a placeholder', async () => {
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit'))
        return Promise.resolve(jsonResponse(topic([post(1, 1)])));
      return Promise.resolve(jsonResponse({ post_stream: { posts: [post(2, 2)] } }));
    });
    vi.stubGlobal('fetch', mockedFetch);

    const result = await (await TopicDataSource.create('123')).loadPage(1, 2);
    expect(result.map((item) => item.id)).toEqual([2, 3]);
    expect(result[1]).toMatchObject({ post_number: 3, hidden: true });
  });

  it('loads a pending article with cached non-contiguous comments into exact offsets', async () => {
    const response = topic([post(2, 2), post(4, 4)]);
    const batches: Array<{ pageOffset: number; ids: number[] }> = [];
    const articles: TopicPost[] = [];
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit')) return Promise.resolve(jsonResponse(response));
      return Promise.resolve(jsonResponse({ post_stream: { posts: [post(3, 3), post(1, 1)] } }));
    });
    vi.stubGlobal('fetch', mockedFetch);

    const source = await TopicDataSource.create('123');
    expect(source.articleReady).toBe(false);
    const result = await source.loadInitial(1, 3, undefined, {
      onArticle: (article) => articles.push(article),
      onCommentBatch: (batch) =>
        batches.push({ pageOffset: batch.pageOffset, ids: batch.posts.map((item) => item.id) }),
    });

    expect(source.article.id).toBe(1);
    expect(articles.map((item) => item.id)).toEqual([1]);
    expect(batches).toEqual([
      { pageOffset: 0, ids: [2] },
      { pageOffset: 2, ids: [4] },
      { pageOffset: 1, ids: [3] },
    ]);
    expect(result.posts.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it('settles a failed comment batch without discarding a concurrent successful batch', async () => {
    const stream = Array.from({ length: 41 }, (_, index) => index + 1);
    const failures: number[][] = [];
    const batches: Array<{ pageOffset: number; ids: number[] }> = [];
    let commentsReady: readonly number[] = [];
    const mockedFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.json?track_visit')) {
        return Promise.resolve(
          jsonResponse({
            ...topic([post(1, 1)]),
            posts_count: stream.length,
            post_stream: { posts: [post(1, 1)], stream },
          }),
        );
      }
      const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
      if (ids.includes(2)) return Promise.resolve(jsonResponse({}, 500));
      return Promise.resolve(
        jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } }),
      );
    });
    vi.stubGlobal('fetch', mockedFetch);

    const result = await (
      await TopicDataSource.create('123')
    ).loadInitial(1, 40, undefined, {
      onCommentBatch: (batch) =>
        batches.push({ pageOffset: batch.pageOffset, ids: batch.posts.map((item) => item.id) }),
      onCommentBatchError: (failure) => failures.push([...failure.pageOffsets]),
      onCommentsReady: (offsets) => {
        commentsReady = offsets;
      },
    });

    expect(failures).toEqual([Array.from({ length: 20 }, (_, index) => index)]);
    expect(batches).toEqual([
      { pageOffset: 20, ids: Array.from({ length: 20 }, (_, index) => index + 22) },
    ]);
    expect(result.failedPageOffsets).toEqual(commentsReady);
    expect(result.posts.map((item) => item.id)).toEqual(stream.slice(21));
  });

  it('rejects an article candidate that is not post number one', async () => {
    const response = topic([post(2, 2)]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.includes('.json?track_visit')
              ? jsonResponse(response)
              : jsonResponse({ post_stream: { posts: [post(1, 2)] } }),
          ),
        ),
    );

    await expect((await TopicDataSource.create('123')).loadInitial(1, 3)).rejects.toThrow(
      '未找到主题正文',
    );
  });

  it('rejects malformed topic payloads', () => {
    expect(() => parseTopicResponse({ id: 1, title: 'x' })).toThrow('主题数据格式无效');
  });

  it('marks topics at the 10,000 post limit as mega topics', async () => {
    const response = { ...topic(), posts_count: 10_000 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(response)));
    expect((await TopicDataSource.create('123')).isMegaTopic).toBe(true);
  });
});

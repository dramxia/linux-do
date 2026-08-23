import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostsUrl,
  fetchPostReplies,
  fetchPosts,
  parseTopicResponse,
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
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

  it('loads 40 comments in two sequential batches of at most 20 posts', async () => {
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

    expect(postsRequestCount).toBe(1);
    expect(postsRequestUrls[0]).toBeDefined();
    expect(
      new URL(postsRequestUrls[0]!, 'https://linux.do').searchParams.getAll('post_ids[]'),
    ).toHaveLength(20);

    releaseFirstBatch?.();
    const result = await loading;

    expect(postsRequestCount).toBe(2);
    expect(
      new URL(postsRequestUrls[1]!, 'https://linux.do').searchParams.getAll('post_ids[]'),
    ).toHaveLength(20);
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

  it('rejects malformed topic payloads', () => {
    expect(() => parseTopicResponse({ id: 1, title: 'x' })).toThrow('主题数据格式无效');
  });

  it('marks topics at the 10,000 post limit as mega topics', async () => {
    const response = { ...topic(), posts_count: 10_000 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(response)));
    expect((await TopicDataSource.create('123')).isMegaTopic).toBe(true);
  });
});

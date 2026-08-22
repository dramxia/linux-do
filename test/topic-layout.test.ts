import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DiscourseSettings } from '../src/common/settings';
import { refreshTopicLayout } from '../src/content/topic-layout';
import type { TopicPost, TopicResponse } from '../src/content/topic-api';
import {
  parseTopicActionRequest,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
} from '../src/content/topic-actions';

const enabledSettings: DiscourseSettings = {
  ...DEFAULT_SETTINGS,
  enableSplitReading: true,
  enablePostActions: false,
};

function post(id: number, postNumber: number): TopicPost {
  return {
    id,
    topic_id: 123,
    post_number: postNumber,
    username: `user-${postNumber}`,
    created_at: '2026-08-22T00:00:00.000Z',
    cooked: `<p>content-${postNumber}</p>`,
  };
}

function topic(overrides: Partial<TopicResponse> = {}): TopicResponse {
  return {
    id: 123,
    title: 'Test topic',
    posts_count: 3,
    last_read_post_number: 1,
    post_stream: {
      posts: [post(2, 2), post(1, 1), post(3, 3)],
      stream: [1, 2, 3],
    },
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  document.documentElement.innerHTML =
    '<head></head><body><header class="d-header"></header><main id="main-outlet"><article class="topic-post" data-post-number="1"></article></main></body>';
  window.history.replaceState({}, '', '/t/topic/123');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  sessionStorage.clear();
});

afterEach(async () => {
  await refreshTopicLayout({ ...enabledSettings, enableSplitReading: false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('topic split layout lifecycle', () => {
  it('mounts article post 1 on the left and comments on the right', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    const root = document.querySelector('.ldtk-topic-reading-root');
    expect(root).not.toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    expect(root?.querySelector('.ldtk-article-pane .cooked')?.textContent).toContain('content-1');
    expect(root?.querySelectorAll('.ldtk-comments-list .topic-post')).toHaveLength(2);
    const grid = root?.querySelector<HTMLElement>('.ldtk-reading-grid');
    const articlePane = root?.querySelector<HTMLElement>('.ldtk-article-pane');
    const articlePost = root?.querySelector<HTMLElement>('.ldtk-article-content.topic-post');
    expect(getComputedStyle(grid as HTMLElement).display).toBe('grid');
    expect(getComputedStyle(articlePane as HTMLElement).overflowX).toBe('hidden');
    expect(getComputedStyle(articlePane as HTMLElement).overflowY).toBe('auto');
    expect(getComputedStyle(articlePost as HTMLElement).display).toBe('block');
  });

  it('shows who a comment replies to even when the target is on another page', async () => {
    const stream = Array.from({ length: 12 }, (_, index) => index + 1);
    const reply = { ...post(12, 12), reply_to_post_number: 2 };
    window.history.replaceState({}, '', '/t/topic/123?ldo_comments_page=2');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('.json?track_visit')) {
          return Promise.resolve(
            jsonResponse(
              topic({
                posts_count: stream.length,
                post_stream: { posts: [post(1, 1)], stream },
              }),
            ),
          );
        }
        const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
        const posts = ids.flatMap((id) => {
          if (id === 2) return [post(2, 2)];
          if (id === 12) return [reply];
          return [];
        });
        return Promise.resolve(jsonResponse({ post_stream: { posts } }));
      }),
    );

    await refreshTopicLayout(enabledSettings);

    const target = document.querySelector<HTMLButtonElement>('.ldtk-reply-target');
    expect(target?.textContent).toBe('回复 @user-2 · #2');
    expect(target?.getAttribute('aria-label')).toBe('跳转到 @user-2 的 2 楼评论');
    expect(target?.dataset.targetFloor).toBe('2');
    expect(getComputedStyle(target as HTMLButtonElement).fontWeight).toBe('600');
  });

  it('renders the original-style post action groups and keeps actions in split mode', async () => {
    const actionablePost: TopicPost = {
      ...post(2, 2),
      reply_count: 14,
      actions_summary: [
        { id: 2, count: 17, can_act: true, acted: false },
        { id: 3, can_act: true },
      ],
      reaction_users_count: 19,
      current_user_reaction: null,
      current_user_used_main_reaction: false,
      bookmarked: false,
      can_edit: true,
      can_delete: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: {
              posts: [post(1, 1), actionablePost, post(3, 3)],
              stream: [1, 2, 3],
            },
          }),
        ),
      ),
    );
    const requests: unknown[] = [];
    const handleAction = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
      const request = parseTopicActionRequest(event.detail);
      if (!request) return;
      requests.push(request);
      event.target.dispatchEvent(
        new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
          detail: JSON.stringify({
            requestId: request.requestId,
            ok: true,
            phase: 'triggered',
          }),
        }),
      );
    };
    document.addEventListener(TOPIC_ACTION_REQUEST_NAME, handleAction, { once: true });

    await refreshTopicLayout(enabledSettings);

    const comment = document.querySelector<HTMLElement>('[data-post-id="2"]');
    const likeCount = comment?.querySelector<HTMLButtonElement>('.post-action-menu__like-count');
    const replies = comment?.querySelector<HTMLButtonElement>('.post-action-menu__show-replies');
    const actions = comment?.querySelector('.ldtk-post-actions');
    expect(likeCount?.textContent).toContain('19');
    expect(likeCount?.querySelector('use')?.getAttribute('href')).toBe('#heart');
    expect(replies?.textContent).toContain('14 个回复');
    const likeButton = actions?.querySelector<HTMLButtonElement>('.post-action-menu__like');
    expect(likeButton?.getAttribute('aria-pressed')).toBe('false');
    expect(likeButton?.querySelector('use')?.getAttribute('href')).toBe('#far-heart');
    expect(actions?.querySelector('.post-action-menu__copy-link')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__bookmark')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__show-more')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__reply')?.textContent).toContain('回复');

    actions?.querySelector<HTMLButtonElement>('.post-action-menu__show-more')?.click();
    expect(actions?.querySelector<HTMLElement>('.ldtk-more-actions')?.hidden).toBe(false);
    expect(actions?.querySelector('.post-action-menu__flag')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__edit')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__share use')?.getAttribute('href')).toBe(
      '#arrow-up-from-bracket',
    );

    actions?.querySelector<HTMLButtonElement>('.post-action-menu__like')?.click();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ action: 'like', topicId: 123, postId: 2, floor: 2 });
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    const composer = document.createElement('section');
    composer.id = 'reply-control';
    composer.className = 'open';
    document.body.appendChild(composer);
    expect(getComputedStyle(composer).zIndex).toBe('400');
    expect(getComputedStyle(composer).visibility).toBe('visible');
  });

  it('expands direct replies inside the split layout', async () => {
    const parent = { ...post(2, 2), reply_count: 2 };
    const directReplies = [
      { ...post(3, 3), reply_to_post_number: 2 },
      { ...post(4, 4), reply_to_post_number: 2 },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/posts/2/replies')) return Promise.resolve(jsonResponse(directReplies));
        return Promise.resolve(
          jsonResponse(
            topic({
              posts_count: 4,
              post_stream: {
                posts: [post(1, 1), parent, ...directReplies],
                stream: [1, 2, 3, 4],
              },
            }),
          ),
        );
      }),
    );

    await refreshTopicLayout(enabledSettings);
    const parentElement = document.querySelector<HTMLElement>('[data-post-id="2"]');
    const repliesButton = parentElement?.querySelector<HTMLButtonElement>(
      '[data-toggle-replies="2"]',
    );
    repliesButton?.click();

    await vi.waitFor(() => {
      expect(parentElement?.querySelectorAll('.ldtk-inline-reply')).toHaveLength(2);
    });
    expect(repliesButton?.getAttribute('aria-expanded')).toBe('true');
    expect(repliesButton?.querySelector('use')?.getAttribute('href')).toBe('#chevron-up');
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
  });

  it('keeps wide comment content complete without widening the comments pane', async () => {
    const wideComment = {
      ...post(2, 2),
      cooked: `
        <p><a href="https://example.com/${'long-segment-'.repeat(20)}">${'long-segment-'.repeat(20)}</a></p>
        <pre><code>${'const-wide-value-'.repeat(20)}</code></pre>
        <table><tbody><tr><td>${'wide-cell-'.repeat(20)}</td></tr></tbody></table>
        <aside class="onebox">${'wide-preview-'.repeat(20)}</aside>
        <img src="https://example.com/wide.png" width="2000" height="1000" alt="wide" />
      `,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: {
              posts: [post(1, 1), wideComment, post(3, 3)],
              stream: [1, 2, 3],
            },
          }),
        ),
      ),
    );

    await refreshTopicLayout(enabledSettings);

    const commentsPane = document.querySelector<HTMLElement>('.ldtk-comments-pane');
    const commentsList = document.querySelector<HTMLElement>('.ldtk-comments-list');
    const comment = commentsList?.querySelector<HTMLElement>('.topic-post');
    const body = comment?.querySelector<HTMLElement>('.topic-body');
    const cooked = comment?.querySelector<HTMLElement>('.cooked');
    const link = cooked?.querySelector<HTMLElement>('a');
    const pre = cooked?.querySelector<HTMLElement>('pre');
    const table = cooked?.querySelector<HTMLElement>('table');
    const onebox = cooked?.querySelector<HTMLElement>('.onebox');
    const image = cooked?.querySelector<HTMLElement>('img');

    expect(getComputedStyle(commentsPane as HTMLElement).overflowX).toBe('hidden');
    expect(getComputedStyle(commentsPane as HTMLElement).overflowY).toBe('auto');
    expect(getComputedStyle(commentsList as HTMLElement).maxWidth).toBe('100%');
    expect(getComputedStyle(comment as HTMLElement).minWidth).toBe('0');
    expect(getComputedStyle(body as HTMLElement).width).toBe('100%');
    expect(getComputedStyle(body as HTMLElement).maxWidth).toBe('100%');
    expect(getComputedStyle(cooked as HTMLElement).overflowX).toBe('auto');
    expect(getComputedStyle(cooked as HTMLElement).maxWidth).toBe('100%');
    expect(getComputedStyle(link as HTMLElement).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(pre as HTMLElement).overflowX).toBe('auto');
    expect(getComputedStyle(pre as HTMLElement).whiteSpace).toBe('pre');
    expect(getComputedStyle(table as HTMLElement).display).toBe('block');
    expect(getComputedStyle(table as HTMLElement).overflowX).toBe('auto');
    expect(getComputedStyle(onebox as HTMLElement).overflowX).toBe('auto');
    expect(getComputedStyle(image as HTMLElement).maxWidth).toBe('100%');
  });

  it('keeps the native page untouched below the desktop breakpoint', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1279 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not activate for mega topics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic({ posts_count: 10_000 }))));
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('restores native layout on load failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'failed' }, 500)));
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.getElementById('main-outlet')).not.toBeNull();
  });

  it('cleans up when SPA navigation leaves a topic route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);
    window.history.replaceState({}, '', '/latest');
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('is idempotent for repeated refreshes on the same topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic()));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let an older page response replace a newer navigation', async () => {
    const stream = Array.from({ length: 26 }, (_, index) => index + 1);
    let resolvePageTwo: (response: Response) => void = () => undefined;
    const pageTwoResponse = new Promise<Response>((resolve) => {
      resolvePageTwo = resolve;
    });
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('.json?track_visit')) {
        return Promise.resolve(
          jsonResponse(
            topic({
              posts_count: stream.length,
              post_stream: { posts: [post(1, 1)], stream },
            }),
          ),
        );
      }
      const ids = new URL(url, 'https://linux.do').searchParams.getAll('post_ids[]').map(Number);
      if (ids[0] === 12) return pageTwoResponse;
      return Promise.resolve(
        jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);

    document.querySelector<HTMLButtonElement>('.ldtk-pagination [data-page="2"]')?.click();
    await Promise.resolve();
    window.history.replaceState({}, '', '/t/topic/123?ldo_comments_page=3');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-comments-list')?.textContent).toContain('content-22');
    });
    resolvePageTwo(
      jsonResponse({
        post_stream: {
          posts: Array.from({ length: 10 }, (_, index) => post(index + 12, index + 12)),
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('.ldtk-comments-list')?.textContent).toContain('content-22');
    expect(document.querySelector('.ldtk-comments-list')?.textContent).not.toContain('content-12');
    expect(document.querySelector('.ldtk-pagination [aria-current="page"]')?.textContent).toBe('3');
  });
});

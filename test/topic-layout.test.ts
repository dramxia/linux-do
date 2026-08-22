import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DiscourseSettings } from '../src/common/settings';
import { injectButtons } from '../src/content/buttons';
import { prepareTopicLayout, refreshTopicLayout } from '../src/content/topic-layout';
import type { TopicPost, TopicResponse } from '../src/content/topic-api';
import {
  parseTopicActionRequest,
  parseTopicReactionPickerRequest,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_REACTION_PICKER_REQUEST_NAME,
} from '../src/content/topic-actions';
import { TOPIC_EVENT_NAME } from '../src/content/topic-events';

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
    '<head></head><body><div class="sidebar-wrapper"><div class="sidebar-container"></div></div><div class="d-header-wrap"><header class="d-header"><button class="header-sidebar-toggle" type="button" aria-label="显示侧边栏">菜单</button><a class="title" href="/">LINUX DO</a></header></div><main id="main-outlet"><article class="topic-post" data-post-number="1"></article></main></body>';
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
  it('preserves the native header while the topic content is replaced', async () => {
    const headerWrap = document.querySelector<HTMLElement>('.d-header-wrap');
    const header = document.querySelector<HTMLElement>('.d-header');
    const headerAction = header?.querySelector<HTMLButtonElement>('button');
    const sidebarWrapper = document.querySelector<HTMLElement>('.sidebar-wrapper');
    const mainOutlet = document.getElementById('main-outlet') as HTMLElement;

    // Some Discourse themes mount the header inside the same page tree as the topic.
    mainOutlet.prepend(sidebarWrapper as HTMLElement);
    vi.spyOn(headerWrap as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1200, 0),
    );
    vi.spyOn(header as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );

    expect(prepareTopicLayout(enabledSettings)).toBe(true);
    expect(getComputedStyle(mainOutlet).visibility).toBe('visible');
    expect(getComputedStyle(sidebarWrapper as HTMLElement).visibility).toBe('visible');
    expect(getComputedStyle(sidebarWrapper as HTMLElement).display).not.toBe('none');
    expect(getComputedStyle(headerWrap as HTMLElement).visibility).toBe('visible');
    expect(getComputedStyle(header as HTMLElement).visibility).toBe('visible');
    expect(getComputedStyle(headerAction as HTMLButtonElement).visibility).toBe('visible');
    expect(getComputedStyle(headerAction as HTMLButtonElement).pointerEvents).toBe('auto');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    const splitRoot = document.querySelector<HTMLElement>('.ldtk-topic-reading-root');
    expect(getComputedStyle(mainOutlet).visibility).toBe('visible');
    expect(getComputedStyle(mainOutlet).pointerEvents).toBe('auto');
    expect(getComputedStyle(mainOutlet).zIndex).not.toBe('400');
    expect(getComputedStyle(sidebarWrapper as HTMLElement).display).not.toBe('none');
    expect(getComputedStyle(headerWrap as HTMLElement).visibility).toBe('visible');
    expect(getComputedStyle(header as HTMLElement).visibility).toBe('visible');
    expect(getComputedStyle(headerAction as HTMLButtonElement).pointerEvents).toBe('auto');
    expect(getComputedStyle(splitRoot as HTMLElement).position).toBe('fixed');
    expect(getComputedStyle(splitRoot as HTMLElement).zIndex).toBe('90');
    expect(splitRoot?.style.getPropertyValue('--ldtk-header-height')).toBe('48px');
    expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
  });

  it('keeps the native page intact while the initial split layout is pending', async () => {
    expect(prepareTopicLayout(enabledSettings)).toBe(true);
    expect(document.documentElement.classList.contains('ldtk-split-reading-pending')).toBe(true);
    expect(getComputedStyle(document.getElementById('main-outlet') as HTMLElement).visibility).toBe(
      'visible',
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    expect(document.documentElement.classList.contains('ldtk-split-reading-pending')).toBe(false);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
  });

  it('follows the native sidebar directly without narrowing the opposite edge', async () => {
    const header = document.querySelector<HTMLElement>('.d-header');
    const toggle = header?.querySelector<HTMLButtonElement>('.header-sidebar-toggle');
    const sidebarWrapper = document.querySelector<HTMLElement>('.sidebar-wrapper');
    const sidebarContainer = sidebarWrapper?.querySelector<HTMLElement>('.sidebar-container');
    let sidebarOpen = false;
    let presentationShift = 0;
    vi.spyOn(header as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
    vi.spyOn(sidebarWrapper as HTMLElement, 'getBoundingClientRect').mockImplementation(() =>
      sidebarOpen
        ? new DOMRect(120 - presentationShift, 48, 280, 800)
        : new DOMRect(120 - presentationShift, 48, 0, 800),
    );
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = nativeGetComputedStyle(element);
      if (element !== sidebarWrapper) return style;
      return new Proxy(style, {
        get(target, property, receiver) {
          return property === 'translate'
            ? `${-presentationShift}px 0px`
            : Reflect.get(target, property, receiver);
        },
      });
    });
    toggle?.addEventListener('click', () => {
      sidebarOpen = !sidebarOpen;
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);
    const splitRoot = document.querySelector<HTMLElement>('.ldtk-topic-reading-root');
    expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-start-inset')).toBe('0px');
    expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset')).toBe('0px');
    const startInsetHistory: number[] = [];
    const setProperty = splitRoot?.style.setProperty.bind(splitRoot.style);
    vi.spyOn(splitRoot?.style as CSSStyleDeclaration, 'setProperty').mockImplementation(
      (property, value, priority) => {
        if (property === '--ldtk-sidebar-start-inset') {
          startInsetHistory.push(Number.parseFloat(value));
        }
        setProperty?.(property, value, priority);
      },
    );

    toggle?.click();
    await vi.waitFor(() => {
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-start-inset')).toBe('400px');
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset')).toBe('120px');
    });
    presentationShift = 30;
    await vi.waitFor(() => {
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-start-inset')).toBe('370px');
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset')).toBe('90px');
    });
    presentationShift = 60;
    await vi.waitFor(() => {
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-start-inset')).toBe('340px');
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset')).toBe('60px');
    });
    expect(sidebarOpen).toBe(true);
    expect(sidebarWrapper?.classList.contains('ldtk-sidebar-center-target')).toBe(true);
    expect(sidebarWrapper?.style.getPropertyValue('--ldtk-sidebar-center-shift')).toBe('60px');
    expect(sidebarContainer?.classList.contains('ldtk-sidebar-center-target')).toBe(false);
    expect(sidebarContainer?.style.translate).toBe('');
    const sidebarRect = sidebarWrapper?.getBoundingClientRect() as DOMRect;
    const shellRight =
      window.innerWidth -
      Number.parseFloat(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset') || '0');
    expect(sidebarRect.left).toBeGreaterThanOrEqual(0);
    expect(sidebarRect.right).toBeLessThanOrEqual(window.innerWidth);
    expect((sidebarRect.left + shellRight) / 2).toBe(window.innerWidth / 2);
    expect(shellRight - sidebarRect.right).toBe(1040);
    expect(startInsetHistory).toEqual([400, 370, 340]);

    startInsetHistory.length = 0;
    toggle?.click();
    await vi.waitFor(() => {
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-start-inset')).toBe('0px');
      expect(splitRoot?.style.getPropertyValue('--ldtk-sidebar-end-inset')).toBe('0px');
    });
    expect(sidebarOpen).toBe(false);
    expect(startInsetHistory).toEqual([0]);
  });

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
    const articleScroll = root?.querySelector<HTMLElement>('.ldtk-article-scroll');
    const articleFooter = root?.querySelector<HTMLElement>('.ldtk-article-footer');
    const articlePost = root?.querySelector<HTMLElement>('.ldtk-article-content.topic-post');
    const articleByline = root?.querySelector<HTMLElement>('.ldtk-article-byline');
    const publishedAt = articleByline?.querySelector<HTMLTimeElement>('time');
    const refreshIcon = root?.querySelector<SVGSVGElement>('.ldtk-toolbar-button svg');
    const commentStatus = root?.querySelector<HTMLElement>('.ldtk-comment-status');
    const previousIcon = root?.querySelector<SVGSVGElement>(
      '.ldtk-pagination button:first-child svg',
    );
    const nextIcon = root?.querySelector<SVGSVGElement>('.ldtk-pagination button:last-child svg');
    expect(getComputedStyle(grid as HTMLElement).display).toBe('grid');
    expect(getComputedStyle(grid as HTMLElement).gap).toBe('10px');
    expect(getComputedStyle(articlePane as HTMLElement).display).toBe('flex');
    expect(getComputedStyle(articlePane as HTMLElement).borderRadius).toBe('var(--ldtk-radius)');
    expect(getComputedStyle(articlePane as HTMLElement).overflowX).toBe('hidden');
    expect(getComputedStyle(articlePane as HTMLElement).overflowY).toBe('hidden');
    expect(getComputedStyle(articleScroll as HTMLElement).overflowY).toBe('auto');
    expect(articleScroll?.contains(articlePost as HTMLElement)).toBe(true);
    expect(articleScroll?.contains(articleFooter as HTMLElement)).toBe(false);
    expect(articlePane?.lastElementChild).toBe(articleFooter);
    expect(getComputedStyle(articlePost as HTMLElement).display).toBe('block');
    expect(articleByline?.querySelector('strong')?.textContent).toBe('user-1');
    expect(publishedAt?.dateTime).toBe('2026-08-22T00:00:00.000Z');
    expect(refreshIcon?.classList.contains('d-icon-lucide-rotate-left')).toBe(true);
    expect(commentStatus?.getAttribute('role')).toBe('status');
    expect(commentStatus?.getAttribute('aria-live')).toBe('polite');
    expect(previousIcon?.classList.contains('d-icon-lucide-chevron-left')).toBe(true);
    expect(nextIcon?.classList.contains('d-icon-lucide-chevron-right')).toBe(true);
  });

  it('keeps native export actions behind the split reading surface', async () => {
    const nativePost = document.querySelector<HTMLElement>('#main-outlet .topic-post');
    nativePost?.appendChild(document.createElement('nav')).classList.add('post-controls');
    const settings = { ...enabledSettings, enablePostActions: true };
    injectButtons(settings);

    const nativeHost = nativePost?.querySelector<HTMLElement>('.ldtk-shadow-host');
    expect(nativeHost?.style.visibility).toBe('inherit');
    expect(nativeHost?.style.pointerEvents).toBe('inherit');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(settings);

    expect(getComputedStyle(document.getElementById('main-outlet') as HTMLElement).visibility).toBe(
      'visible',
    );
    expect(document.getElementById('ldtk-topic-reading-style')?.textContent).toContain(
      '#main-outlet .ldtk-shadow-host',
    );
    expect(document.querySelectorAll('#main-outlet .ldtk-shadow-host')).toHaveLength(1);
    expect(document.querySelectorAll('.ldtk-topic-reading-root .ldtk-shadow-host')).toHaveLength(3);
  });

  it('keeps the current split layout visible until a forced refresh is ready', async () => {
    let resolveRefresh: (response: Response) => void = () => undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(topic({ title: 'Before refresh' })))
      .mockReturnValueOnce(pendingRefresh);
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);

    const previousRoot = document.querySelector('.ldtk-topic-reading-root');
    const refreshButton = previousRoot?.querySelector<HTMLButtonElement>('.ldtk-toolbar-button');
    refreshButton?.click();
    await Promise.resolve();

    expect(previousRoot?.isConnected).toBe(true);
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    expect(getComputedStyle(document.getElementById('main-outlet') as HTMLElement).visibility).toBe(
      'visible',
    );

    resolveRefresh(jsonResponse(topic({ title: 'After refresh' })));
    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-topic-reading-root h1')?.textContent).toBe(
        'After refresh',
      );
    });

    const nextRoot = document.querySelector('.ldtk-topic-reading-root');
    expect(previousRoot?.isConnected).toBe(false);
    expect(nextRoot).not.toBe(previousRoot);
    expect(nextRoot?.querySelector('h1')?.textContent).toBe('After refresh');
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
  });

  it('keeps the current split layout when a forced refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(topic()))
      .mockRejectedValueOnce(new Error('refresh failed'));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    const previousRoot = document.querySelector('.ldtk-topic-reading-root');
    const refreshButton = previousRoot?.querySelector<HTMLButtonElement>('.ldtk-toolbar-button');

    refreshButton?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(refreshButton?.getAttribute('aria-busy')).toBeNull());

    expect(previousRoot?.isConnected).toBe(true);
    expect(refreshButton?.disabled).toBe(false);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBe(previousRoot);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
  });

  it('places the complete article actions and topic information after the cooked body', async () => {
    const article: TopicPost = {
      ...post(1, 1),
      reply_count: 7,
      reaction_users_count: 199,
      reactions: [{ id: 'heart', type: 'emoji', count: 199 }],
      actions_summary: [{ id: 2, count: 199, can_act: true, acted: false }],
    };
    const directReply: TopicPost = {
      ...post(2, 2),
      cooked:
        '<p>等一等图片，这是一段必须完整显示且允许自动换行的回复内容 <img class="emoji" alt=":white_check_mark:" src="/check.png"></p>',
      avatar_template: '/avatar/{size}/reply.png',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input).includes('/posts/1/replies')) {
          return Promise.resolve(jsonResponse([directReply]));
        }
        return Promise.resolve(
          jsonResponse(
            topic({
              views: 10_700,
              like_count: 484,
              participant_count: 2_700,
              word_count: 49_800,
              details: {
                can_create_post: true,
                links: [{ url: 'https://example.com' }, { url: 'https://linux.do' }],
                participants: [
                  { username: 'alice', name: 'Alice', avatar_template: '/avatar/{size}/alice.png' },
                ],
              },
              post_stream: { posts: [article, directReply, post(3, 3)], stream: [1, 2, 3] },
            }),
          ),
        );
      }),
    );

    await refreshTopicLayout({ ...enabledSettings, enablePostActions: true });

    const articlePane = document.querySelector('.ldtk-article-pane');
    const articleScroll = articlePane?.querySelector('.ldtk-article-scroll');
    const footer = articlePane?.querySelector('.ldtk-article-footer');
    expect(footer).toBe(articlePane?.lastElementChild);
    expect(articleScroll?.contains(footer as Node)).toBe(false);
    expect(getComputedStyle(footer as HTMLElement).flexGrow).toBe('0');
    expect(footer?.querySelector('.post-action-menu__like-count')?.textContent).toContain('199');
    expect(footer?.querySelector('.post-action-menu__show-replies')?.textContent).toContain(
      '7 个回复',
    );
    expect(footer?.querySelector('.post-action-menu__like')).not.toBeNull();
    expect(footer?.querySelector('.post-action-menu__copy-link')).not.toBeNull();
    expect(footer?.querySelector('.post-action-menu__show-more')).not.toBeNull();
    expect(footer?.querySelector('.post-action-menu__reply')).not.toBeNull();
    expect(footer?.querySelectorAll('.ldtk-shadow-host')).toHaveLength(1);
    const replySummary = footer?.querySelector<HTMLElement>('.ldtk-article-reply-summary');
    const replyChip = replySummary?.querySelector<HTMLButtonElement>('.ldtk-article-reply-chip');
    const replyContent = replyChip?.querySelector<HTMLElement>('.ldtk-article-reply-content');
    expect(replyContent?.textContent?.trim()).toBe(
      '等一等图片，这是一段必须完整显示且允许自动换行的回复内容',
    );
    expect(getComputedStyle(replyContent as HTMLElement).whiteSpace).toBe('normal');
    expect(getComputedStyle(replyContent as HTMLElement).overflowWrap).toBe('anywhere');
    expect(replyChip?.dataset.targetFloor).toBe('2');
    expect(replyChip?.querySelector('.ldtk-article-reply-avatar')?.getAttribute('src')).toBe(
      '/avatar/90/reply.png',
    );
    const emoji = replyContent?.querySelector<HTMLImageElement>('img.emoji');
    expect(emoji?.getAttribute('src')).toBe('/check.png');
    expect(emoji?.alt).toBe(':white_check_mark:');
    expect(emoji?.width).toBe(18);
    expect(emoji?.height).toBe(18);
    expect(replyChip?.getAttribute('aria-label')).toContain(':white_check_mark:');
    const repliesButton = footer?.querySelector<HTMLButtonElement>(
      '.post-action-menu__show-replies',
    );
    expect(repliesButton?.getAttribute('aria-expanded')).toBe('true');
    repliesButton?.click();
    expect(replySummary?.hidden).toBe(true);
    repliesButton?.click();
    expect(replySummary?.hidden).toBe(false);
    expect(footer?.querySelector('.ldtk-topic-summary')?.textContent).toContain(
      '10.7k浏览量484赞2链接2.7k用户249 分钟阅读时间',
    );
    expect(footer?.querySelector('.ldtk-topic-participants a')?.getAttribute('href')).toBe(
      '/u/alice',
    );
  });

  it('renders complete Boost content and the native Boost triggers in split mode', async () => {
    const article: TopicPost = {
      ...post(1, 1),
      can_boost: true,
      boosts: [
        {
          id: 91,
          cooked:
            '<p>这是一条需要完整显示的 Boost 内容 <img class="emoji" alt=":rocket:" src="/rocket.png"></p>',
          user: {
            id: 11,
            username: 'booster',
            name: 'Booster',
            avatar_template: '/avatar/{size}/booster.png',
          },
        },
      ],
    };
    const comment: TopicPost = { ...post(2, 2), boosts: [], can_boost: true };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: { posts: [article, comment, post(3, 3)], stream: [1, 2, 3] },
          }),
        ),
      ),
    );

    await refreshTopicLayout(enabledSettings);

    const footer = document.querySelector('.ldtk-article-footer');
    const bubble = footer?.querySelector<HTMLElement>('.discourse-boosts__bubble');
    const cooked = bubble?.querySelector<HTMLElement>('.discourse-boosts__cooked');
    expect(cooked?.textContent?.trim()).toBe('这是一条需要完整显示的 Boost 内容');
    expect(getComputedStyle(cooked as HTMLElement).whiteSpace).toBe('normal');
    expect(getComputedStyle(cooked as HTMLElement).overflowWrap).toBe('anywhere');
    expect(cooked?.querySelector<HTMLImageElement>('img.emoji')?.getAttribute('src')).toBe(
      '/rocket.png',
    );
    expect(bubble?.querySelector('.avatar')?.getAttribute('src')).toBe('/avatar/90/booster.png');
    expect(bubble?.querySelector('a')?.getAttribute('href')).toBe('/u/booster');
    const addBoost = footer?.querySelector<HTMLButtonElement>('.discourse-boosts__add-btn');
    expect(addBoost?.dataset.topicAction).toBe('boost');
    expect(addBoost?.getAttribute('aria-haspopup')).toBe('menu');
    expect(addBoost?.querySelector('svg')?.classList.contains('d-icon-lucide-rocket')).toBe(true);
    expect(footer?.querySelector('.post-action-menu__boost')).toBeNull();

    const commentBoost = document.querySelector<HTMLButtonElement>(
      '.ldtk-comments-list [data-post-id="2"] .post-action-menu__boost',
    );
    expect(commentBoost?.dataset.topicAction).toBe('boost');
    expect(commentBoost?.querySelector('svg')?.classList.contains('d-icon-lucide-rocket')).toBe(
      true,
    );

    const nativeBoostInput = document.createElement('div');
    nativeBoostInput.className = 'discourse-boosts__input-container';
    document.getElementById('main-outlet')?.appendChild(nativeBoostInput);
    expect(getComputedStyle(nativeBoostInput).visibility).toBe('visible');
    expect(getComputedStyle(nativeBoostInput).pointerEvents).toBe('auto');
  });

  it('refreshes the article Boost row after a discourse-boosts event', async () => {
    const initialArticle: TopicPost = { ...post(1, 1), boosts: [], can_boost: true };
    const boostedArticle: TopicPost = {
      ...initialArticle,
      can_boost: false,
      boosts: [
        {
          id: 92,
          cooked: '<p>实时助推 <img class="emoji" alt=":tada:" src="/tada.png"></p>',
          user: { id: 12, username: 'live-user' },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input).includes('.json?track_visit')) {
          return Promise.resolve(
            jsonResponse(
              topic({
                post_stream: {
                  posts: [initialArticle, post(2, 2), post(3, 3)],
                  stream: [1, 2, 3],
                },
              }),
            ),
          );
        }
        return Promise.resolve(jsonResponse({ post_stream: { posts: [boostedArticle] } }));
      }),
    );
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-article-footer .post-action-menu__boost')).not.toBeNull();

    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: JSON.stringify({ topicId: 123, type: 'boost_added', postId: 1 }),
      }),
    );

    await vi.waitFor(() => {
      const footer = document.querySelector('.ldtk-article-footer');
      expect(footer?.querySelector('.discourse-boosts__cooked')?.textContent).toContain('实时助推');
      expect(footer?.querySelector('.post-action-menu__boost')).toBeNull();
    });
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
    expect(likeCount?.querySelector('svg')?.classList.contains('d-icon-lucide-heart')).toBe(true);
    expect(replies?.textContent).toContain('14 个回复');
    const likeButton = actions?.querySelector<HTMLButtonElement>('.post-action-menu__like');
    expect(likeButton?.getAttribute('aria-pressed')).toBe('false');
    expect(likeButton?.querySelector('svg')?.classList.contains('d-icon-lucide-far-heart')).toBe(
      true,
    );
    expect(actions?.querySelector('.post-action-menu__copy-link')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__bookmark')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__show-more')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__reply')?.textContent).toContain('回复');

    actions?.querySelector<HTMLButtonElement>('.post-action-menu__show-more')?.click();
    expect(actions?.querySelector<HTMLElement>('.ldtk-more-actions')?.hidden).toBe(false);
    expect(actions?.querySelector('.post-action-menu__flag')).not.toBeNull();
    expect(actions?.querySelector('.post-action-menu__edit')).not.toBeNull();
    expect(
      actions
        ?.querySelector('.post-action-menu__share svg')
        ?.classList.contains('d-icon-lucide-arrow-up-from-bracket'),
    ).toBe(true);

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

  it('forwards like hover and focus to the native reaction picker without leaving split mode', async () => {
    const actionablePost: TopicPost = {
      ...post(2, 2),
      actions_summary: [{ id: 2, count: 0, can_act: true, acted: false }],
      current_user_used_main_reaction: false,
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
    document.addEventListener(TOPIC_REACTION_PICKER_REQUEST_NAME, (event) => {
      if (event instanceof CustomEvent) {
        requests.push(parseTopicReactionPickerRequest(event.detail));
      }
    });

    await refreshTopicLayout(enabledSettings);

    const button = document.querySelector<HTMLButtonElement>(
      '.ldtk-topic-reading-root [data-post-id="2"] .post-action-menu__like',
    );
    expect(button?.getAttribute('aria-haspopup')).toBe('menu');
    const pointerOver = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(pointerOver, 'pointerType', { value: 'mouse' });
    button?.dispatchEvent(pointerOver);
    const pointerOut = new MouseEvent('pointerout', { bubbles: true });
    Object.defineProperty(pointerOut, 'pointerType', { value: 'mouse' });
    button?.dispatchEvent(pointerOut);
    button?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    button?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(requests).toHaveLength(4);
    expect(requests).toEqual([
      expect.objectContaining({ topicId: 123, postId: 2, floor: 2, open: true }),
      expect.objectContaining({ topicId: 123, postId: 2, floor: 2, open: false }),
      expect.objectContaining({ topicId: 123, postId: 2, floor: 2, open: true }),
      expect.objectContaining({ topicId: 123, postId: 2, floor: 2, open: false }),
    ]);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    expect(
      getComputedStyle(document.getElementById('main-outlet') as HTMLElement).display,
    ).not.toBe('none');
    expect(getComputedStyle(document.getElementById('main-outlet') as HTMLElement).visibility).toBe(
      'visible',
    );
    const nativePicker = document.createElement('div');
    nativePicker.className = 'discourse-reactions-picker is-expanded';
    document.getElementById('main-outlet')?.appendChild(nativePicker);
    expect(getComputedStyle(nativePicker).visibility).toBe('visible');
    expect(getComputedStyle(nativePicker).pointerEvents).toBe('auto');
    expect(getComputedStyle(nativePicker).zIndex).toBe('410');
  });

  it('shows the selected custom reaction image after an acted event', async () => {
    const initialPost: TopicPost = {
      ...post(2, 2),
      actions_summary: [{ id: 2, count: 0, can_act: true, acted: false }],
      reaction_users_count: 0,
      current_user_reaction: null,
      current_user_used_main_reaction: false,
    };
    const reactedPost: TopicPost = {
      ...initialPost,
      actions_summary: [{ id: 2, count: 1, can_act: true, acted: false }],
      reaction_users_count: 1,
      current_user_reaction: { id: 'cry', type: 'emoji', can_undo: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input).includes('.json?track_visit')) {
          return Promise.resolve(
            jsonResponse(
              topic({
                post_stream: {
                  posts: [post(1, 1), initialPost, post(3, 3)],
                  stream: [1, 2, 3],
                },
              }),
            ),
          );
        }
        return Promise.resolve(jsonResponse({ post_stream: { posts: [reactedPost] } }));
      }),
    );
    await refreshTopicLayout(enabledSettings);

    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: JSON.stringify({
          topicId: 123,
          type: 'acted',
          postId: 2,
          currentReactionId: 'cry',
          currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
        }),
      }),
    );

    await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '.ldtk-topic-reading-root [data-post-id="2"] .post-action-menu__like',
      );
      expect(button?.getAttribute('aria-pressed')).toBe('true');
      expect(button?.classList.contains('has-reaction')).toBe(true);
      expect(button?.querySelector('svg')).toBeNull();
      expect(button?.querySelector<HTMLImageElement>('.btn-toggle-reaction-emoji')?.src).toBe(
        'https://cdn.linux.do/images/emoji/twitter/cry.png',
      );
    });
  });

  it('refreshes the article footer when the first post reaction changes', async () => {
    const initialArticle: TopicPost = {
      ...post(1, 1),
      actions_summary: [{ id: 2, count: 0, can_act: true, acted: false }],
      reaction_users_count: 0,
      current_user_reaction: null,
      current_user_used_main_reaction: false,
    };
    const reactedArticle: TopicPost = {
      ...initialArticle,
      actions_summary: [{ id: 2, count: 1, can_act: true, acted: false }],
      reaction_users_count: 1,
      reactions: [{ id: 'cry', type: 'emoji', count: 1 }],
      current_user_reaction: { id: 'cry', type: 'emoji', can_undo: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input).includes('.json?track_visit')) {
          return Promise.resolve(
            jsonResponse(
              topic({
                post_stream: {
                  posts: [initialArticle, post(2, 2), post(3, 3)],
                  stream: [1, 2, 3],
                },
              }),
            ),
          );
        }
        return Promise.resolve(jsonResponse({ post_stream: { posts: [reactedArticle] } }));
      }),
    );
    await refreshTopicLayout(enabledSettings);

    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: JSON.stringify({
          topicId: 123,
          type: 'acted',
          postId: 1,
          currentReactionId: 'cry',
          currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
        }),
      }),
    );

    await vi.waitFor(() => {
      const footer = document.querySelector('.ldtk-article-footer');
      const button = footer?.querySelector<HTMLButtonElement>('.post-action-menu__like');
      expect(button?.classList.contains('has-reaction')).toBe(true);
      expect(button?.querySelector<HTMLImageElement>('.btn-toggle-reaction-emoji')?.src).toBe(
        'https://cdn.linux.do/images/emoji/twitter/cry.png',
      );
    });
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
    expect(
      repliesButton?.querySelector('svg')?.classList.contains('d-icon-lucide-chevron-up'),
    ).toBe(true);
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
    const refreshButton = document.querySelector<HTMLButtonElement>('.ldtk-toolbar-button');
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
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
    expect(refreshButton?.disabled).toBe(false);
    expect(refreshButton?.getAttribute('aria-busy')).toBeNull();
  });
});

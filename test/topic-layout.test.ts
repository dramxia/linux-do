import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DiscourseSettings } from '../src/common/settings';
import { injectButtons } from '../src/content/buttons';
import {
  prepareTopicLayout,
  TopicLayoutRuntime,
  topicLayoutOwnedSelectors,
} from '../src/content/topic-layout';
import type { TopicPost, TopicResponse } from '../src/content/topic-api';
import { TOPIC_CODE_HIGHLIGHT_REQUEST_NAME } from '../src/content/topic-code-blocks';
import {
  parseTopicActionRequest,
  parseTopicInteractionRequest,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_INTERACTION_REQUEST_NAME,
  TOPIC_INTERACTION_RESULT_NAME,
} from '../src/content/topic-actions';
import { TOPIC_EVENT_NAME } from '../src/content/topic-events';

const enabledSettings: DiscourseSettings = {
  ...DEFAULT_SETTINGS,
  enableSplitReading: true,
  enablePostActions: false,
};

let topicLayoutRuntime: TopicLayoutRuntime;

function refreshTopicLayout(settings: DiscourseSettings, force = false): Promise<void> {
  return topicLayoutRuntime.activate(settings, force);
}

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

function dispatchPointer(
  target: Element,
  type: string,
  options: { clientY: number; pointerId?: number; button?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: options.clientY,
    button: options.button ?? 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
}

beforeEach(() => {
  topicLayoutRuntime = new TopicLayoutRuntime();
  document.documentElement.innerHTML =
    '<head></head><body><div class="sidebar-wrapper"><div class="sidebar-container"></div></div><div class="d-header-wrap"><header class="d-header"><button class="header-sidebar-toggle" type="button" aria-label="显示侧边栏">菜单</button><a class="title" href="/">LINUX DO</a></header></div><main id="main-outlet"><article class="topic-post" data-post-number="1"></article></main></body>';
  window.history.replaceState({}, '', '/t/topic/123');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  sessionStorage.clear();
});

afterEach(async () => {
  topicLayoutRuntime.disable();
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

  it('mounts an accessible stable shell before pending comments resolve', async () => {
    let resolveComments!: (response: Response) => void;
    const pendingComments = new Promise<Response>((resolve) => {
      resolveComments = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(topic({ post_stream: { posts: [post(1, 1)], stream: [1, 2, 3] } })),
        )
        .mockReturnValueOnce(pendingComments),
    );

    const loading = refreshTopicLayout(enabledSettings);
    await vi.waitFor(() =>
      expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull(),
    );

    const commentsPane = document.querySelector<HTMLElement>('.ldtk-comments-pane');
    const slots = Array.from(document.querySelectorAll<HTMLElement>('.ldtk-comment-slot'));
    expect(commentsPane?.getAttribute('aria-busy')).toBe('true');
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => getComputedStyle(slot).minHeight === '118px')).toBe(true);
    expect(slots.every((slot) => slot.querySelector('[aria-hidden="true"]'))).toBe(true);
    expect(document.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    expect(document.getElementById('ldtk-topic-reading-loading')?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    resolveComments(jsonResponse({ post_stream: { posts: [post(3, 3), post(2, 2)] } }));
    await loading;

    expect(commentsPane?.getAttribute('aria-busy')).toBe('false');
    expect(
      slots.map((slot) => slot.querySelector<HTMLElement>('.topic-post')?.dataset.postNumber),
    ).toEqual(['2', '3']);
  });

  it('keeps successful comments visible when another initial batch fails', async () => {
    const stream = Array.from({ length: 41 }, (_, index) => index + 1);
    const settings = { ...enabledSettings, commentsPerPage: 40 as const };
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
        if (ids.includes(2)) return Promise.resolve(jsonResponse({}, 500));
        return Promise.resolve(
          jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } }),
        );
      }),
    );

    await refreshTopicLayout(settings);

    const slots = Array.from(document.querySelectorAll<HTMLElement>('.ldtk-comment-slot'));
    expect(slots.filter((slot) => slot.dataset.state === 'failed')).toHaveLength(20);
    expect(slots.filter((slot) => slot.dataset.state === 'ready')).toHaveLength(20);
    expect(document.querySelectorAll('[data-retry-comments]')).toHaveLength(1);
    expect(getComputedStyle(slots[0] as HTMLElement).minHeight).toBe('2360px');
    expect(document.querySelector('.ldtk-comment-status')?.textContent).toContain(
      '部分评论加载失败',
    );
    expect(document.querySelector('.ldtk-comments-pane')?.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector<HTMLButtonElement>('[data-retry-comments]')?.disabled).toBe(
      false,
    );
  });

  it('updates to the centered sidebar layout without animation', async () => {
    const header = document.querySelector<HTMLElement>('.d-header');
    const toggle = header?.querySelector<HTMLButtonElement>('.header-sidebar-toggle');
    const sidebarWrapper = document.querySelector<HTMLElement>('.sidebar-wrapper');
    const sidebarContainer = sidebarWrapper?.querySelector<HTMLElement>('.sidebar-container');
    let sidebarOpen = false;
    vi.spyOn(header as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
    vi.spyOn(sidebarWrapper as HTMLElement, 'getBoundingClientRect').mockImplementation(() => {
      const shift =
        Number.parseFloat(
          sidebarWrapper?.style.getPropertyValue('--ldtk-sidebar-center-shift') || '',
        ) || 0;
      return sidebarOpen
        ? new DOMRect(120 - shift, 48, 280, 800)
        : new DOMRect(120 - shift, 48, 0, 800);
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
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--d-sidebar-animation-time')
        .trim(),
    ).toBe('0ms');
    expect(startInsetHistory).toEqual([340]);

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
    const articleFooterResizer = root?.querySelector<HTMLElement>('.ldtk-article-footer-resizer');
    const articlePost = root?.querySelector<HTMLElement>('.ldtk-article-content.topic-post');
    const articleByline = root?.querySelector<HTMLElement>('.ldtk-article-byline');
    const publishedAt = articleByline?.querySelector<HTMLTimeElement>('time');
    const refreshButton = root?.querySelector<HTMLButtonElement>('.ldtk-toolbar-button');
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
    expect(getComputedStyle(articleFooter as HTMLElement).maxHeight).toBe('min(21vh, 130px)');
    expect(articleFooterResizer?.getAttribute('role')).toBe('separator');
    expect(articleFooterResizer?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(articleFooterResizer?.tabIndex).toBe(0);
    expect(getComputedStyle(articlePost as HTMLElement).display).toBe('block');
    expect(articleByline?.querySelector('strong')?.textContent).toBe('user-1');
    expect(publishedAt?.dateTime).toBe('2026-08-22T00:00:00.000Z');
    expect(getComputedStyle(refreshButton as HTMLButtonElement).display).toBe('inline-flex');
    expect(getComputedStyle(refreshButton as HTMLButtonElement).alignItems).toBe('center');
    expect(getComputedStyle(refreshButton as HTMLButtonElement).justifyContent).toBe('center');
    expect(getComputedStyle(refreshButton as HTMLButtonElement).width).toBe('30px');
    expect(getComputedStyle(refreshButton as HTMLButtonElement).height).toBe('30px');
    expect(refreshIcon?.classList.contains('d-icon-lucide-rotate-left')).toBe(true);
    expect(getComputedStyle(refreshIcon as SVGSVGElement).position).toBe('static');
    expect(getComputedStyle(refreshIcon as SVGSVGElement).margin).toBe('0px');
    expect(commentStatus?.getAttribute('role')).toBe('status');
    expect(commentStatus?.getAttribute('aria-live')).toBe('polite');
    expect(previousIcon?.classList.contains('d-icon-lucide-chevron-left')).toBe(true);
    expect(nextIcon?.classList.contains('d-icon-lucide-chevron-right')).toBe(true);
  });

  it('highlights article code blocks and provides the native-style copy control', async () => {
    const article = {
      ...post(1, 1),
      cooked: '<pre><code>创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画</code></pre>',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: {
              posts: [article, post(2, 2), post(3, 3)],
              stream: [1, 2, 3],
            },
          }),
        ),
      ),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const nativeHighlight = vi.fn(() => {
      const code = document.querySelector<HTMLElement>('.ldtk-article-content pre > code');
      if (!code) return;
      const highlighted = document.createElement('span');
      highlighted.className = 'hljs-selector-tag';
      highlighted.textContent = code.textContent;
      code.replaceChildren(highlighted);
      code.classList.add('hljs');
      code.dataset.highlighted = 'yes';
    });
    document.addEventListener(TOPIC_CODE_HIGHLIGHT_REQUEST_NAME, nativeHighlight, { once: true });

    await refreshTopicLayout(enabledSettings);

    const pre = document.querySelector<HTMLElement>('.ldtk-article-content .cooked pre');
    const code = pre?.querySelector<HTMLElement>('code');
    const copy = pre?.querySelector<HTMLButtonElement>('.codeblock-button-wrapper .copy-cmd');
    expect(pre?.classList.contains('codeblock-buttons')).toBe(true);
    expect(nativeHighlight).toHaveBeenCalledOnce();
    expect(getComputedStyle(pre as HTMLElement).padding).toBe('0px');
    expect(getComputedStyle(code as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.children.length).toBeGreaterThan(0);
    expect(copy?.getAttribute('aria-label')).toBe('复制代码');
    expect(copy?.querySelector('svg.d-icon-lucide-copy')).not.toBeNull();

    copy?.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画');
      expect(copy?.classList.contains('action-complete')).toBe(true);
      expect(copy?.getAttribute('aria-label')).toBe('代码已复制');
      expect(copy?.textContent).toBe('已复制');
    });
  });

  it('resizes the article footer by pointer and keyboard, then restores its height', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    const articlePane = document.querySelector<HTMLElement>('.ldtk-article-pane') as HTMLElement;
    const footer = articlePane.querySelector<HTMLElement>('.ldtk-article-footer') as HTMLElement;
    const resizer = footer.querySelector<HTMLElement>(
      '.ldtk-article-footer-resizer',
    ) as HTMLElement;
    Object.defineProperty(articlePane, 'clientHeight', { configurable: true, value: 700 });
    vi.spyOn(footer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 570, 700, 130));
    Object.defineProperty(resizer, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(resizer, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    let resizeFrame: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        resizeFrame = callback;
        return 42;
      });

    dispatchPointer(resizer, 'pointerdown', { clientY: 570 });
    dispatchPointer(resizer, 'pointermove', { clientY: 540 });
    dispatchPointer(resizer, 'pointermove', { clientY: 510 });
    dispatchPointer(resizer, 'pointermove', { clientY: 470 });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(footer.style.height).toBe('');
    resizeFrame?.(performance.now());
    expect(footer.style.height).toBe('230px');

    dispatchPointer(resizer, 'pointerup', { clientY: 470 });

    expect(footer.style.height).toBe('230px');
    expect(footer.style.maxHeight).toBe('350px');
    expect(resizer.getAttribute('aria-valuenow')).toBe('230');
    expect(articlePane.dataset.resizingFooter).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem('ldtk:split-reading:123') || '{}')).toMatchObject({
      articleFooterHeight: 230,
    });

    dispatchPointer(resizer, 'pointerdown', { clientY: 470, pointerId: 2 });
    dispatchPointer(resizer, 'pointermove', { clientY: 430, pointerId: 2 });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(footer.style.height).toBe('230px');
    dispatchPointer(resizer, 'pointerup', { clientY: 420, pointerId: 2 });
    expect(footer.style.height).toBe('280px');

    resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    expect(footer.style.height).toBe('296px');
    resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    expect(footer.style.height).toBe('350px');
    resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    expect(footer.style.height).toBe('64px');

    resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    await refreshTopicLayout(enabledSettings, true);
    const restoredFooter = document.querySelector<HTMLElement>('.ldtk-article-footer');
    expect(restoredFooter?.style.height).toBe('80px');
    expect(
      restoredFooter?.querySelector('.ldtk-article-footer-resizer')?.getAttribute('aria-valuenow'),
    ).toBe('80');
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

  it('preserves comment scroll and focused controls across a retained refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(topic({ title: 'Before refresh' })))
      .mockResolvedValueOnce(jsonResponse(topic({ title: 'After refresh' })));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);

    const commentsPane = document.querySelector<HTMLElement>('.ldtk-comments-pane') as HTMLElement;
    const focused = document.querySelector<HTMLButtonElement>('[data-copy-post-link="2"]');
    commentsPane.scrollTop = 180;
    focused?.focus();
    await refreshTopicLayout(enabledSettings, true);

    const nextPane = document.querySelector<HTMLElement>('.ldtk-comments-pane');
    expect(nextPane?.scrollTop).toBe(180);
    expect(document.activeElement).toMatchObject({ dataset: { copyPostLink: '2' } });
  });

  it('shows an article skeleton until a deep-route article candidate is verified', async () => {
    window.history.replaceState({}, '', '/t/topic/123/40');
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    let resolvePosts!: (response: Response) => void;
    const pendingPosts = new Promise<Response>((resolve) => {
      resolvePosts = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(topic({ post_stream: { posts: [post(2, 2)], stream: [1, 2, 3] } })),
        )
        .mockReturnValueOnce(pendingPosts),
    );

    const loading = refreshTopicLayout(enabledSettings);
    await vi.waitFor(() => expect(document.querySelector('.ldtk-article-skeleton')).not.toBeNull());
    expect(document.querySelector('.ldtk-article-pane')?.getAttribute('aria-busy')).toBe('true');

    resolvePosts(jsonResponse({ post_stream: { posts: [post(3, 3), post(1, 1)] } }));
    await loading;

    expect(document.querySelector('.ldtk-article-skeleton')).toBeNull();
    expect(document.querySelector('.ldtk-article-pane')?.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('.ldtk-article-content')?.getAttribute('data-post-number')).toBe(
      '1',
    );
    expect(window.location.pathname).toBe('/t/topic/123/40');
    expect(new URL(window.location.href).searchParams.has('ldo_comments_page')).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('restores a saved deep comment page without any history mutation', async () => {
    const stream = Array.from({ length: 81 }, (_, index) => index + 1);
    sessionStorage.setItem(
      'ldtk:split-reading:123',
      JSON.stringify({ page: 5, leftScrollTop: 0, rightScrollTop: 240 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            posts_count: stream.length,
            post_stream: { posts: stream.map((id) => post(id, id)), stream },
          }),
        ),
      ),
    );
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    await refreshTopicLayout({ ...enabledSettings, commentsPerPage: 10 });

    expect(document.querySelector('.ldtk-pagination [aria-current="page"]')?.textContent).toBe('5');
    expect(document.querySelector('[data-post-number="50"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.ldtk-comments-pane')?.scrollTop).toBe(240);
    expect(window.location.pathname).toBe('/t/topic/123');
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps one activation alive while Discourse rewrites floors during deep loading', async () => {
    window.history.replaceState({}, '', '/t/topic/123/40');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    let resolveTopic!: (response: Response) => void;
    const pendingTopic = new Promise<Response>((resolve) => {
      resolveTopic = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(pendingTopic);
    vi.stubGlobal('fetch', fetchMock);

    const loading = refreshTopicLayout(enabledSettings);
    for (const floor of [20, 50, 80]) {
      window.history.replaceState({}, '', `/t/topic/123/${floor}`);
    }
    const stream = Array.from({ length: 61 }, (_, index) => index + 1);
    resolveTopic(
      jsonResponse(
        topic({
          posts_count: stream.length,
          post_stream: { posts: stream.map((id) => post(id, id)), stream },
        }),
      ),
    );
    await loading;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
    expect(window.location.pathname).toBe('/t/topic/123/80');
    expect(new URL(window.location.href).searchParams.has('ldo_comments_page')).toBe(false);
    expect(scrollIntoView).toHaveBeenCalled();
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

  it('renders complete Boost content and opens the split Boost editor in place', async () => {
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

    commentBoost?.click();
    const editor = document.querySelector<HTMLFormElement>(
      '.ldtk-comments-list [data-post-id="2"] .ldtk-boost-editor',
    );
    const input = editor?.querySelector<HTMLInputElement>('.ldtk-boost-input');
    const submit = editor?.querySelector<HTMLButtonElement>('.ldtk-boost-submit');
    expect(editor).not.toBeNull();
    expect(input?.maxLength).toBe(16);
    expect(input?.getAttribute('aria-describedby')).toBeTruthy();
    expect(submit?.disabled).toBe(true);
    expect(commentBoost?.getAttribute('aria-expanded')).toBe('true');
    editor?.querySelector<HTMLButtonElement>('.ldtk-boost-cancel')?.click();
    expect(document.querySelector('.ldtk-boost-editor')).toBeNull();
    expect(commentBoost?.getAttribute('aria-expanded')).toBe('false');
  });

  it('submits Boost from a paginated comment without changing the split URL', async () => {
    const stream = Array.from({ length: 13 }, (_, index) => index + 1);
    const targetPost = { ...post(12, 12), boosts: [], can_boost: true };
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
        return Promise.resolve(
          jsonResponse({
            post_stream: {
              posts: ids.map((id) => (id === targetPost.id ? targetPost : post(id, id))),
            },
          }),
        );
      }),
    );
    let actionRequest: ReturnType<typeof parseTopicActionRequest> = null;
    document.addEventListener(
      TOPIC_ACTION_REQUEST_NAME,
      (event) => {
        if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
        actionRequest = parseTopicActionRequest(event.detail);
        if (!actionRequest) return;
        event.target.dispatchEvent(
          new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
            detail: JSON.stringify({
              requestId: actionRequest.requestId,
              ok: true,
              phase: 'settled',
            }),
          }),
        );
      },
      { once: true },
    );

    await refreshTopicLayout({ ...enabledSettings, commentsPerPage: 10 });
    document
      .querySelector<HTMLButtonElement>('[data-post-id="12"] [data-topic-action="boost"]')
      ?.click();
    const editor = document.querySelector<HTMLFormElement>(
      '[data-post-id="12"] .ldtk-boost-editor',
    );
    const input = editor?.querySelector<HTMLInputElement>('.ldtk-boost-input');
    if (input) {
      input.value = '分页助推';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor?.requestSubmit();

    expect(actionRequest).toMatchObject({
      action: 'boost',
      floor: 12,
      postId: 12,
      boostRaw: '分页助推',
    });
    const actionUrl = new URL(actionRequest?.routeUrl || window.location.href);
    expect(actionUrl.pathname).toBe('/t/topic/123/12');
    expect(actionUrl.searchParams.has('ldo_comments_page')).toBe(false);
    expect(new URL(window.location.href).searchParams.get('ldo_comments_page')).toBe('2');
  });

  it('keeps a failed Boost editor open with its value and focus', async () => {
    const boostedPost = { ...post(2, 2), boosts: [], can_boost: true };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: {
              posts: [post(1, 1), boostedPost, post(3, 3)],
              stream: [1, 2, 3],
            },
          }),
        ),
      ),
    );
    document.addEventListener(
      TOPIC_ACTION_REQUEST_NAME,
      (event) => {
        if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
        const request = parseTopicActionRequest(event.detail);
        if (!request) return;
        event.target.dispatchEvent(
          new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
            detail: JSON.stringify({
              requestId: request.requestId,
              ok: false,
              phase: 'settled',
              message: '你已经助推过此楼层',
            }),
          }),
        );
      },
      { once: true },
    );

    await refreshTopicLayout(enabledSettings);
    document
      .querySelector<HTMLButtonElement>('[data-post-id="2"] [data-topic-action="boost"]')
      ?.click();
    const editor = document.querySelector<HTMLFormElement>('[data-post-id="2"] .ldtk-boost-editor');
    const input = editor?.querySelector<HTMLInputElement>('.ldtk-boost-input');
    if (input) {
      input.value = '保留输入';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor?.requestSubmit();

    expect(document.querySelector('.ldtk-boost-editor')).toBe(editor);
    expect(input?.value).toBe('保留输入');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(editor?.querySelector('.ldtk-boost-error')?.textContent).toBe('你已经助推过此楼层');
  });

  it('shows paginated like users inside split mode without changing history', async () => {
    const likedPost: TopicPost = {
      ...post(2, 2),
      actions_summary: [{ id: 2, count: 31, can_act: true, acted: false }],
      reaction_users_count: 31,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          topic({
            post_stream: {
              posts: [post(1, 1), likedPost, post(3, 3)],
              stream: [1, 2, 3],
            },
          }),
        ),
      ),
    );
    const requests: ReturnType<typeof parseTopicInteractionRequest>[] = [];
    document.addEventListener(TOPIC_INTERACTION_REQUEST_NAME, (event) => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
      const request = parseTopicInteractionRequest(event.detail);
      if (!request || request.interaction !== 'likeUsers') return;
      requests.push(request);
      const page = request.page || 0;
      event.target.dispatchEvent(
        new CustomEvent(TOPIC_INTERACTION_RESULT_NAME, {
          detail: JSON.stringify({
            requestId: request.requestId,
            interaction: request.interaction,
            ok: true,
            users: [
              {
                id: page + 1,
                username: page === 0 ? 'alice' : 'bob',
                name: page === 0 ? 'Alice' : 'Bob',
                avatarTemplate: `/avatar/${page + 1}/{size}.png`,
              },
            ],
            total: 31,
            hasMore: page === 0,
          }),
        }),
      );
    });

    await refreshTopicLayout(enabledSettings);
    const url = window.location.href;
    const button = document.querySelector<HTMLButtonElement>(
      '[data-post-id="2"] .post-action-menu__like-count',
    );
    button?.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.ldtk-like-user')?.textContent).toContain('Alice'),
    );
    document.querySelector<HTMLButtonElement>('.ldtk-like-users-more')?.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.ldtk-like-users-list')?.textContent).toContain('Bob'),
    );

    expect(requests.map((request) => request?.page)).toEqual([0, 1]);
    expect(window.location.href).toBe(url);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    document.querySelector<HTMLButtonElement>('.ldtk-inline-popover-close')?.click();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
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
    expect(actions?.querySelector('.ldtk-reaction-picker-trigger')).toBeNull();
    expect(likeButton?.getAttribute('aria-haspopup')).toBe('dialog');
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

    actions?.querySelector<HTMLButtonElement>('.post-action-menu__bookmark')?.click();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ action: 'bookmark', topicId: 123, postId: 2, floor: 2 });
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    const composer = document.createElement('section');
    composer.id = 'reply-control';
    composer.className = 'open';
    document.body.appendChild(composer);
    expect(getComputedStyle(composer).zIndex).toBe('400');
    expect(getComputedStyle(composer).visibility).toBe('visible');
  });

  it('opens the split-owned reaction picker on like hover and keeps click for liking', async () => {
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
    document.addEventListener(TOPIC_INTERACTION_REQUEST_NAME, (event) => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
      const request = parseTopicInteractionRequest(event.detail);
      if (!request) return;
      requests.push(request);
      event.target.dispatchEvent(
        new CustomEvent(TOPIC_INTERACTION_RESULT_NAME, {
          detail: JSON.stringify({
            requestId: request.requestId,
            interaction: request.interaction,
            ok: true,
            reactionOptions: [
              { id: 'heart', url: 'https://linux.do/heart.png', isMain: true },
              { id: 'cry', url: 'https://linux.do/cry.png', isMain: false },
            ],
          }),
        }),
      );
    });
    document.addEventListener(TOPIC_ACTION_REQUEST_NAME, (event) => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
      const request = parseTopicActionRequest(event.detail);
      if (!request) return;
      requests.push(request);
      event.target.dispatchEvent(
        new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
          detail: JSON.stringify({ requestId: request.requestId, ok: true, phase: 'settled' }),
        }),
      );
    });

    await refreshTopicLayout(enabledSettings);

    const button = document.querySelector<HTMLButtonElement>(
      '.ldtk-topic-reading-root [data-post-id="2"] .post-action-menu__like',
    );
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    const readingRoot = document.querySelector<HTMLElement>('.ldtk-topic-reading-root');
    vi.spyOn(readingRoot as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1200, 800),
    );
    vi.spyOn(button as HTMLButtonElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(900, 760, 30, 30),
    );
    const url = window.location.href;
    const pointerOver = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(pointerOver, 'pointerType', { value: 'mouse' });
    button?.dispatchEvent(pointerOver);
    const pendingPopover = document.querySelector<HTMLElement>('.ldtk-reaction-picker');
    vi.spyOn(pendingPopover as HTMLElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 340, 180),
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.ldtk-reaction-option')).toHaveLength(2);
    });
    expect(requests[0]).toMatchObject({ interaction: 'reactionOptions', postId: 2, floor: 2 });
    const initialPopover = document.querySelector<HTMLElement>('.ldtk-reaction-picker');
    expect(initialPopover?.parentElement).toBe(readingRoot);
    expect(initialPopover?.closest('.ldtk-post-controls')).toBeNull();
    expect(getComputedStyle(initialPopover as HTMLElement).position).toBe('absolute');
    expect(initialPopover?.dataset.placement).toBe('top');
    expect(initialPopover?.style.left).not.toBe('');
    expect(initialPopover?.style.top).toBe('574px');
    expect(document.activeElement).not.toBe(document.querySelector('.ldtk-reaction-picker'));

    button?.click();
    expect(requests[1]).toMatchObject({ action: 'like', postId: 2, floor: 2 });

    const popover = document.querySelector<HTMLElement>('.ldtk-reaction-picker');
    const pointerOut = new MouseEvent('pointerout', { bubbles: true, relatedTarget: popover });
    Object.defineProperty(pointerOut, 'pointerType', { value: 'mouse' });
    button?.dispatchEvent(pointerOut);
    expect(document.querySelector('.ldtk-reaction-picker')).toBe(popover);

    const leavePopover = new MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: document.body,
    });
    Object.defineProperty(leavePopover, 'pointerType', { value: 'mouse' });
    popover?.dispatchEvent(leavePopover);
    await vi.waitFor(() => expect(document.querySelector('.ldtk-reaction-picker')).toBeNull());

    const reopen = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(reopen, 'pointerType', { value: 'mouse' });
    button?.dispatchEvent(reopen);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.ldtk-reaction-option')).toHaveLength(2);
    });
    expect(requests[2]).toMatchObject({ interaction: 'reactionOptions', postId: 2, floor: 2 });

    document.querySelector<HTMLButtonElement>('[data-reaction-id="cry"]')?.click();
    await vi.waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[3]).toMatchObject({ action: 'reaction', reactionId: 'cry', postId: 2 });
    expect(window.location.href).toBe(url);
    expect(document.querySelector('.ldtk-reaction-picker')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
    expect(
      getComputedStyle(document.getElementById('main-outlet') as HTMLElement).display,
    ).not.toBe('none');
    expect(getComputedStyle(document.getElementById('main-outlet') as HTMLElement).visibility).toBe(
      'visible',
    );
    expect(document.querySelector('#main-outlet .discourse-reactions-picker')).toBeNull();
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

  it.each(['/latest', '/t/category/99/topic/123'])(
    'never activates outside a strict topic detail route: %s',
    async (pathname) => {
      window.history.replaceState({}, '', pathname);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await refreshTopicLayout(enabledSettings);

      expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
      expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a topic response that does not match the detail route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic({ id: 456 })));
    vi.stubGlobal('fetch', fetchMock);

    await refreshTopicLayout(enabledSettings);

    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.getElementById('ldtk-topic-reading-loading')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('does not activate for mega topics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic({ posts_count: 10_000 })));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restores native layout on load failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'failed' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.getElementById('main-outlet')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await refreshTopicLayout({ ...enabledSettings, enableSplitReading: false });
    fetchMock.mockResolvedValue(jsonResponse(topic()));
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up when SPA navigation leaves a topic route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);
    window.history.replaceState({}, '', '/latest');
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('removes every stale split root when leaving a topic page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);
    document.body.appendChild(
      Object.assign(document.createElement('section'), {
        className: 'ldtk-topic-reading-root',
      }),
    );

    window.history.replaceState({}, '', '/latest');
    topicLayoutRuntime.suspend();

    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(0);
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('cleans up when the native topic article is replaced under the same URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    document
      .getElementById('main-outlet')
      ?.querySelector('[data-post-number="1"]')
      ?.replaceWith(Object.assign(document.createElement('section'), { className: 'topic-list' }));
    topicLayoutRuntime.reconcilePageContext();

    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('stays active when Discourse rebuilds valid topic DOM under the same route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    await refreshTopicLayout(enabledSettings);

    const replacement = document.createElement('article');
    replacement.className = 'topic-post';
    replacement.dataset.postNumber = '1';
    document
      .getElementById('main-outlet')
      ?.querySelector('[data-post-number="1"]')
      ?.replaceWith(replacement);
    topicLayoutRuntime.reconcilePageContext();

    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
  });

  it('is idempotent for repeated refreshes on the same topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic()));
    vi.stubGlobal('fetch', fetchMock);
    await refreshTopicLayout(enabledSettings);
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses topic data across repeated disable and enable cycles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic()));
    vi.stubGlobal('fetch', fetchMock);

    for (let cycle = 0; cycle < 6; cycle += 1) {
      await refreshTopicLayout(enabledSettings);
      expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
      await refreshTopicLayout({ ...enabledSettings, enableSplitReading: false });
      expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    }
    await refreshTopicLayout(enabledSettings);

    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale request failure tear down the latest layout', async () => {
    let rejectFirstRequest: (reason: Error) => void = () => undefined;
    const firstResponse = new Promise<Response>((_resolve, reject) => {
      rejectFirstRequest = reject;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValue(jsonResponse(topic()));
    vi.stubGlobal('fetch', fetchMock);

    const staleRefresh = refreshTopicLayout(enabledSettings);
    await Promise.resolve();
    await refreshTopicLayout({ ...enabledSettings, enableSplitReading: false });
    await refreshTopicLayout(enabledSettings);
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();

    rejectFirstRequest(new Error('stale network failure'));
    await staleRefresh;

    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(true);
  });

  it('keeps the current loading overlay through a rapid disable and re-enable', async () => {
    let resolveSecondRequest: (response: Response) => void = () => undefined;
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecondRequest = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      })
      .mockImplementationOnce(() => secondResponse);
    vi.stubGlobal('fetch', fetchMock);

    const firstRefresh = refreshTopicLayout(enabledSettings);
    await Promise.resolve();
    await refreshTopicLayout({ ...enabledSettings, enableSplitReading: false });
    const secondRefresh = refreshTopicLayout(enabledSettings);

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect(document.getElementById('ldtk-topic-reading-loading')).not.toBeNull();

    resolveSecondRequest(jsonResponse(topic()));
    await Promise.all([firstRefresh, secondRefresh]);
    expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
  });

  it('does not mount a pending topic response after navigation returns home', async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => pendingResponse),
    );

    const pendingRefresh = refreshTopicLayout(enabledSettings);
    await Promise.resolve();
    window.history.replaceState({}, '', '/latest');
    resolveRequest(jsonResponse(topic()));
    await pendingRefresh;

    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('does not mount a pending response after the native topic page is replaced', async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => pendingResponse),
    );

    const pendingRefresh = refreshTopicLayout(enabledSettings);
    await Promise.resolve();
    document
      .getElementById('main-outlet')
      ?.replaceWith(Object.assign(document.createElement('main'), { id: 'main-outlet' }));
    resolveRequest(jsonResponse(topic()));
    await pendingRefresh;

    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    expect(document.getElementById('ldtk-topic-reading-loading')).toBeNull();
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });

  it('marks the loading overlay as toolkit-owned DOM', () => {
    const overlay = document.createElement('div');
    overlay.id = 'ldtk-topic-reading-loading';

    expect(topicLayoutOwnedSelectors.some((selector) => overlay.matches(selector))).toBe(true);
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
    await refreshTopicLayout({ ...enabledSettings, commentsPerPage: 10 });

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

  it('changes comment pages without writing browser history', async () => {
    const stream = Array.from({ length: 22 }, (_, index) => index + 1);
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
        return Promise.resolve(
          jsonResponse({ post_stream: { posts: ids.map((id) => post(id, id)) } }),
        );
      }),
    );
    await refreshTopicLayout({ ...enabledSettings, commentsPerPage: 10 });
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const url = window.location.href;

    document.querySelector<HTMLButtonElement>('.ldtk-pagination [data-page="2"]')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-pagination [aria-current="page"]')?.textContent).toBe(
        '2',
      );
    });

    expect(window.location.href).toBe(url);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

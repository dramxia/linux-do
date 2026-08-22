import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseTopicActionResult,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  type TopicActionRequest,
} from '../src/content/topic-actions';

interface BridgeTestWindow extends Window {
  MessageBus: {
    callbacks: Array<{ channel?: string; last_id?: number }>;
    subscribe: (channel: string) => void;
    unsubscribe: (channel: string) => void;
  };
  require: (moduleName: string) => unknown;
}

const pageWindow = window as unknown as BridgeTestWindow;
let routeTo: (url: string) => void = () => undefined;
let topicController: unknown = null;

function request(action: TopicActionRequest['action'], postId = 2): TopicActionRequest {
  return {
    requestId: `bridge:${postId}`,
    topicId: 123,
    postId,
    floor: postId,
    action,
    routeUrl: `${window.location.origin}/t/topic/123/${postId}?ldo_comments_page=1`,
  };
}

function dispatchRequest(button: HTMLButtonElement, detail: TopicActionRequest): Promise<unknown> {
  return new Promise((resolve) => {
    button.addEventListener(
      TOPIC_ACTION_RESULT_NAME,
      (event) => resolve(parseTopicActionResult((event as CustomEvent).detail)),
      { once: true },
    );
    button.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(detail),
      }),
    );
  });
}

beforeAll(async () => {
  pageWindow.MessageBus = {
    callbacks: [],
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  pageWindow.require = (moduleName: string): unknown => {
    if (moduleName === 'discourse/lib/plugin-api') {
      return {
        withPluginApi: (_version: string, callback: (api: unknown) => void) =>
          callback({
            onPageChange: vi.fn(),
            container: { lookup: () => topicController },
          }),
      };
    }
    if (moduleName === 'discourse/lib/url')
      return { default: { routeTo: (url: string) => routeTo(url) } };
    return undefined;
  };
  await import('../src/page/topic-events-bridge');
});

beforeEach(() => {
  document.body.innerHTML = '<main id="main-outlet"></main>';
  window.history.replaceState({}, '', '/t/topic/123');
  routeTo = () => undefined;
  topicController = null;
});

describe('page-world topic action bridge', () => {
  it('clicks an already loaded native control and reports success', async () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const nativeLike = document.createElement('button');
    nativeLike.className = 'post-action-menu__like';
    const click = vi.fn();
    nativeLike.addEventListener('click', click);
    nativePost.appendChild(nativeLike);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    document.body.appendChild(visibleButton);

    await expect(dispatchRequest(visibleButton, request('like'))).resolves.toEqual({
      requestId: 'bridge:2',
      ok: true,
      phase: 'triggered',
    });
    expect(click).toHaveBeenCalledOnce();
  });

  it('uses the Discourse Reactions control when the like button is replaced by the plugin', async () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const shim = document.createElement('div');
    shim.className = 'discourse-reactions-actions-button-shim';
    const nativeReaction = document.createElement('div');
    nativeReaction.className = 'discourse-reactions-reaction-button';
    const click = vi.fn();
    nativeReaction.addEventListener('click', click);
    shim.appendChild(nativeReaction);
    nativePost.appendChild(shim);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    document.body.appendChild(visibleButton);

    await expect(dispatchRequest(visibleButton, request('like'))).resolves.toEqual({
      requestId: 'bridge:2',
      ok: true,
      phase: 'triggered',
    });
    expect(click).toHaveBeenCalledOnce();
  });

  it('tracks the Discourse Reactions users panel until it closes', async () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const nativeCounter = document.createElement('div');
    nativeCounter.className = 'discourse-reactions-counter';
    const statePanel = document.createElement('div');
    statePanel.className = 'discourse-reactions-state-panel';
    nativeCounter.appendChild(statePanel);
    nativeCounter.addEventListener('click', () => {
      statePanel.classList.add('is-expanded');
      window.setTimeout(() => statePanel.classList.remove('is-expanded'), 0);
    });
    nativePost.appendChild(nativeCounter);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    visibleButton.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 160, y: 96, width: 32, height: 32 });
    document.body.appendChild(visibleButton);
    const results: unknown[] = [];
    visibleButton.addEventListener(TOPIC_ACTION_RESULT_NAME, (event) => {
      results.push(parseTopicActionResult((event as CustomEvent).detail));
    });

    visibleButton.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(request('likeUsers')),
      }),
    );

    await vi.waitFor(() => expect(results).toHaveLength(2));
    expect(results).toEqual([
      { requestId: 'bridge:2', ok: true, phase: 'triggered' },
      { requestId: 'bridge:2', ok: true, phase: 'settled' },
    ]);
    expect(nativeCounter.getBoundingClientRect().x).toBe(160);
  });

  it('anchors the native bookmark menu to the visible split button and reports close', async () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const nativeBookmark = document.createElement('button');
    nativeBookmark.className = 'post-action-menu__bookmark';
    nativeBookmark.setAttribute('aria-expanded', 'false');
    nativeBookmark.addEventListener('click', () => {
      nativeBookmark.setAttribute('aria-expanded', 'true');
      window.setTimeout(() => nativeBookmark.setAttribute('aria-expanded', 'false'), 0);
    });
    nativePost.appendChild(nativeBookmark);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    visibleButton.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 120, y: 80, width: 32, height: 32 });
    document.body.appendChild(visibleButton);
    const results: unknown[] = [];
    visibleButton.addEventListener(TOPIC_ACTION_RESULT_NAME, (event) => {
      results.push(parseTopicActionResult((event as CustomEvent).detail));
    });

    visibleButton.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(request('bookmark')),
      }),
    );

    await vi.waitFor(() => expect(results).toHaveLength(2));
    expect(results).toEqual([
      { requestId: 'bridge:2', ok: true, phase: 'triggered' },
      { requestId: 'bridge:2', ok: true, phase: 'settled' },
    ]);
    expect(nativeBookmark.getBoundingClientRect().x).toBe(120);
  });

  it('opens replies through the topic controller without navigating the hidden layout', async () => {
    const post = { id: 8 };
    const loadPost = vi.fn().mockResolvedValue(post);
    const replyToPost = vi.fn().mockImplementation(async () => {
      const composer = document.createElement('section');
      composer.id = 'reply-control';
      composer.className = 'open';
      document.body.appendChild(composer);
    });
    topicController = {
      model: {
        postStream: {
          findLoadedPost: vi.fn(),
          loadPost,
        },
      },
      replyToPost,
    };
    routeTo = vi.fn();
    const visibleButton = document.createElement('button');
    document.body.appendChild(visibleButton);

    await expect(dispatchRequest(visibleButton, request('reply', 8))).resolves.toEqual({
      requestId: 'bridge:8',
      ok: true,
      phase: 'triggered',
    });
    expect(loadPost).toHaveBeenCalledWith(8);
    expect(replyToPost).toHaveBeenCalledWith(post);
    expect(routeTo).not.toHaveBeenCalled();
    expect(document.querySelector('#reply-control.open')).not.toBeNull();
  });

  it('falls back to the composer service when the topic controller does not open it', async () => {
    const topic = {
      draft_key: 'topic_123',
      draft_sequence: 4,
      details: { can_create_post: true },
    };
    const post = { id: 8, topic };
    const replyToPost = vi.fn();
    const open = vi.fn().mockImplementation(async () => {
      const composer = document.createElement('section');
      composer.id = 'reply-control';
      composer.className = 'open';
      document.body.appendChild(composer);
    });
    topicController = {
      model: {
        postStream: {
          findLoadedPost: vi.fn().mockReturnValue(post),
        },
      },
      composer: { open },
      replyToPost,
    };
    const visibleButton = document.createElement('button');
    document.body.appendChild(visibleButton);

    await expect(dispatchRequest(visibleButton, request('reply', 8))).resolves.toEqual({
      requestId: 'bridge:8',
      ok: true,
      phase: 'triggered',
    });
    expect(replyToPost).toHaveBeenCalledWith(post);
    expect(open).toHaveBeenCalledWith({
      action: 'reply',
      draftKey: 'topic_123',
      draftSequence: 4,
      post,
    });
  });

  it('waits for a missing floor action menu before clicking the reply fallback', async () => {
    const click = vi.fn();
    routeTo = (url: string) => {
      window.history.pushState({}, '', url);
      const nativePost = document.createElement('article');
      nativePost.className = 'topic-post';
      nativePost.dataset.postId = '8';
      nativePost.dataset.postNumber = '8';
      document.getElementById('main-outlet')?.appendChild(nativePost);
      window.setTimeout(() => {
        const nativeReply = document.createElement('button');
        nativeReply.className = 'post-action-menu__reply';
        nativeReply.addEventListener('click', () => {
          click();
          const composer = document.createElement('section');
          composer.id = 'reply-control';
          composer.className = 'open';
          document.body.appendChild(composer);
        });
        nativePost.appendChild(nativeReply);
      }, 0);
    };
    const visibleButton = document.createElement('button');
    document.body.appendChild(visibleButton);

    await expect(dispatchRequest(visibleButton, request('reply', 8))).resolves.toEqual({
      requestId: 'bridge:8',
      ok: true,
      phase: 'triggered',
    });
    expect(click).toHaveBeenCalledOnce();
    expect(window.location.search).toContain('ldo_comments_page=1');
    expect(document.querySelector('#reply-control.open')).not.toBeNull();
  });
});

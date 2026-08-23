import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseTopicActionResult,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_REACTION_PICKER_REQUEST_NAME,
  type TopicActionRequest,
  type TopicReactionPickerRequest,
} from '../src/content/topic-actions';
import {
  HISTORY_NAVIGATION_EVENT_NAME,
  PAGE_NAVIGATION_EVENT_NAME,
} from '../src/common/topic-route';
import { parseTopicEventDetail, TOPIC_EVENT_NAME } from '../src/content/topic-events';

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
let reactionToggleCallback: ((value: unknown) => void) | null = null;
let pageChangeCallback: (() => void) | null = null;

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

function dispatchReactionPicker(
  button: HTMLButtonElement,
  detail: TopicReactionPickerRequest,
): void {
  button.dispatchEvent(
    new CustomEvent(TOPIC_REACTION_PICKER_REQUEST_NAME, {
      bubbles: true,
      detail: JSON.stringify(detail),
    }),
  );
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
            onPageChange: (pageCallback: () => void) => {
              pageChangeCallback = pageCallback;
            },
            onAppEvent: (name: string, eventCallback: (value: unknown) => void) => {
              if (name === 'discourse-reactions:reaction-toggled') {
                reactionToggleCallback = eventCallback;
              }
            },
            container: { lookup: () => topicController },
          }),
      };
    }
    if (moduleName === 'discourse/lib/url')
      return { default: { routeTo: (url: string) => routeTo(url) } };
    if (moduleName === 'discourse/lib/text') {
      return {
        emojiUrlFor: (reactionId: string) =>
          `https://cdn.linux.do/images/emoji/twitter/${reactionId}.png`,
      };
    }
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
  it('dispatches definitive navigation signals for history and completed page changes', () => {
    const historyNavigation = vi.fn();
    const pageNavigation = vi.fn();
    document.addEventListener(HISTORY_NAVIGATION_EVENT_NAME, historyNavigation);
    document.addEventListener(PAGE_NAVIGATION_EVENT_NAME, pageNavigation);

    window.history.pushState({}, '', '/latest');
    pageChangeCallback?.();

    expect(historyNavigation).toHaveBeenCalledOnce();
    expect(pageNavigation).toHaveBeenCalledOnce();
  });

  it('forwards the local custom reaction result with its native emoji URL', async () => {
    const detail = new Promise((resolve) => {
      document.addEventListener(
        TOPIC_EVENT_NAME,
        (event) => resolve(parseTopicEventDetail((event as CustomEvent).detail)),
        { once: true },
      );
    });

    reactionToggleCallback?.({
      post: { id: 2, topic_id: 123, current_user_reaction: { id: 'cry' } },
      reaction: { id: 'cry' },
    });

    await expect(detail).resolves.toEqual({
      topicId: 123,
      type: 'acted',
      postId: 2,
      currentReactionId: 'cry',
      currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
    });
  });

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

  it('forwards hover to the native reactions picker and anchors it to the split button', () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const shim = document.createElement('div');
    shim.className = 'discourse-reactions-actions-button-shim';
    const nativeReaction = document.createElement('div');
    nativeReaction.className = 'discourse-reactions-reaction-button';
    const pointerTypes: string[] = [];
    nativeReaction.addEventListener('pointerover', (event) => {
      pointerTypes.push((event as PointerEvent).pointerType);
    });
    nativeReaction.addEventListener('pointerout', (event) => {
      pointerTypes.push((event as PointerEvent).pointerType);
    });
    shim.appendChild(nativeReaction);
    nativePost.appendChild(shim);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    visibleButton.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 180, y: 112, width: 32, height: 32 });
    document.body.appendChild(visibleButton);
    const pickerRequest: TopicReactionPickerRequest = {
      topicId: 123,
      postId: 2,
      floor: 2,
      open: true,
      routeUrl: `${window.location.origin}/t/topic/123/2?ldo_comments_page=1`,
    };

    dispatchReactionPicker(visibleButton, pickerRequest);
    dispatchReactionPicker(visibleButton, { ...pickerRequest, open: false });

    expect(pointerTypes).toEqual(['mouse', 'mouse']);
    expect(nativeReaction.getBoundingClientRect().x).toBe(180);
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

  it('opens the native Boost menu from the split-layout rocket button', async () => {
    const nativePost = document.createElement('article');
    nativePost.className = 'topic-post';
    nativePost.dataset.postId = '2';
    nativePost.dataset.postNumber = '2';
    const nativeBoost = document.createElement('button');
    nativeBoost.className = 'discourse-boosts__add-btn';
    nativeBoost.setAttribute('aria-expanded', 'false');
    nativeBoost.addEventListener('click', () => {
      nativeBoost.setAttribute('aria-expanded', 'true');
      window.setTimeout(() => nativeBoost.setAttribute('aria-expanded', 'false'), 0);
    });
    nativePost.appendChild(nativeBoost);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const visibleButton = document.createElement('button');
    visibleButton.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 144, y: 88, width: 32, height: 32 });
    document.body.appendChild(visibleButton);
    const results: unknown[] = [];
    visibleButton.addEventListener(TOPIC_ACTION_RESULT_NAME, (event) => {
      results.push(parseTopicActionResult((event as CustomEvent).detail));
    });

    visibleButton.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(request('boost')),
      }),
    );

    await vi.waitFor(() => expect(results).toHaveLength(2));
    expect(results).toEqual([
      { requestId: 'bridge:2', ok: true, phase: 'triggered' },
      { requestId: 'bridge:2', ok: true, phase: 'settled' },
    ]);
    expect(nativeBoost.getBoundingClientRect().x).toBe(144);
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
